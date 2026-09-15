package com.spamtext.app.work

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.telephony.SmsManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.spamtext.app.Prefs
import com.spamtext.app.R
import com.spamtext.app.SpamtextApp
import com.spamtext.app.data.ApiClient
import com.spamtext.app.data.ReportPayload
import org.json.JSONArray
import org.json.JSONObject

/**
 * Uploads one or more reports to the backend and, for texts, forwards to 7726 (AT&T spam reporting).
 * Retries with backoff while offline.
 */
class ReportWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val prefs = Prefs(applicationContext)
        if (!prefs.configured) { notify("Spamtext not set up", "Open the app and enter the server URL and API key."); return Result.failure() }
        val payloads = decode(inputData.getString(KEY_PAYLOADS) ?: return Result.failure())
        if (payloads.isEmpty()) return Result.success()

        // 7726 forwarding first, so the upload records it. Done once per run (WorkManager may retry uploads).
        val forwarded = if (prefs.auto7726 && runAttemptCount == 0) forward7726(prefs, payloads) else emptySet()
        val toSend = payloads.map { if (it.kind == "sms" && it.sender in forwarded) it.copy(forwarded7726 = true) else it }

        return try {
            val res = ApiClient(prefs).postReports(toSend)
            toSend.forEach { prefs.markReported("${it.kind}|${it.sender}|${it.receivedAt}"); it.audioPath?.let { p -> java.io.File(p).delete() } }
            val created = res.count { it.second }
            notify("Reported ${toSend.size} item${if (toSend.size == 1) "" else "s"}", if (created < toSend.size) "$created new, ${toSend.size - created} already reported" else "Complaints and tracking are queued.")
            Result.success()
        } catch (e: Exception) {
            if (runAttemptCount < 5) Result.retry() else { notify("Upload failed", e.message ?: "unknown error"); Result.failure() }
        }
    }

    /** Forward each text body to 7726. AT&T then replies asking for the sender's number; SmsReceiver answers that. */
    private fun forward7726(prefs: Prefs, payloads: List<ReportPayload>): Set<String> {
        if (ContextCompat.checkSelfPermission(applicationContext, Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) return emptySet()
        val sms = applicationContext.getSystemService(SmsManager::class.java) ?: return emptySet()
        val done = HashSet<String>()
        for (p in payloads) {
            if (p.kind != "sms" || p.body.isNullOrBlank()) continue
            try {
                val parts = sms.divideMessage(p.body)
                sms.sendMultipartTextMessage("7726", null, parts, null, null)
                prefs.push7726(p.sender)
                done += p.sender
            } catch (_: Exception) { /* keep going */ }
        }
        return done
    }

    private fun notify(title: String, text: String) {
        if (ContextCompat.checkSelfPermission(applicationContext, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val n = NotificationCompat.Builder(applicationContext, SpamtextApp.CHANNEL_REPORTS)
            .setSmallIcon(R.drawable.ic_stat_report).setContentTitle(title).setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text)).setAutoCancel(true).build()
        applicationContext.getSystemService(NotificationManager::class.java).notify(NOTIF_RESULT, n)
    }

    companion object {
        private const val KEY_PAYLOADS = "payloads"
        const val NOTIF_RESULT = 1001

        fun enqueue(context: Context, payloads: List<ReportPayload>) {
            // Batches of 10 keep each upload small (WorkManager input data is capped at ~10 KB, audio goes alone).
            val batches = payloads.filter { it.audioPath != null }.map { listOf(it) } + payloads.filter { it.audioPath == null }.chunked(10)
            for (batch in batches) {
                val data: Data = workDataOf(KEY_PAYLOADS to encode(batch))
                val req = OneTimeWorkRequestBuilder<ReportWorker>()
                    .setInputData(data)
                    .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                    .build()
                WorkManager.getInstance(context).enqueueUniqueWork("report-${System.nanoTime()}", ExistingWorkPolicy.KEEP, req)
            }
        }

        fun encode(list: List<ReportPayload>): String = JSONArray().also { arr ->
            list.forEach { p ->
                arr.put(JSONObject().apply {
                    put("kind", p.kind); put("sender", p.sender); put("body", p.body ?: JSONObject.NULL); put("receivedAt", p.receivedAt)
                    put("durationSeconds", p.durationSeconds ?: JSONObject.NULL); put("prerecorded", p.prerecorded ?: JSONObject.NULL)
                    put("forwarded7726", p.forwarded7726); put("audioPath", p.audioPath ?: JSONObject.NULL); put("audioMime", p.audioMime ?: JSONObject.NULL)
                })
            }
        }.toString()

        fun decode(s: String): List<ReportPayload> {
            val arr = JSONArray(s)
            return (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                ReportPayload(
                    kind = o.getString("kind"), sender = o.getString("sender"),
                    body = if (o.isNull("body")) null else o.getString("body"), receivedAt = o.getLong("receivedAt"),
                    durationSeconds = if (o.isNull("durationSeconds")) null else o.getInt("durationSeconds"),
                    prerecorded = if (o.isNull("prerecorded")) null else o.getBoolean("prerecorded"),
                    forwarded7726 = o.optBoolean("forwarded7726", false),
                    audioPath = if (o.isNull("audioPath")) null else o.getString("audioPath"),
                    audioMime = if (o.isNull("audioMime")) null else o.getString("audioMime"),
                )
            }
        }
    }
}
