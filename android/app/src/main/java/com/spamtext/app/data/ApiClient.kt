package com.spamtext.app.data

import com.spamtext.app.Prefs
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.concurrent.TimeUnit

class ApiClient(private val prefs: Prefs) {
    private val http = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).writeTimeout(60, TimeUnit.SECONDS)
        .build()
    private val json = "application/json; charset=utf-8".toMediaType()

    private fun req(path: String) = Request.Builder()
        .url(prefs.baseUrl + path)
        .header("X-Api-Key", prefs.apiKey)

    /** Returns the list of (id, created) for each report. Throws on failure. */
    fun postReports(reports: List<ReportPayload>): List<Pair<String, Boolean>> {
        val arr = JSONArray()
        for (r in reports) arr.put(JSONObject().apply {
            put("kind", r.kind)
            put("sender", r.sender)
            put("body", r.body ?: JSONObject.NULL)
            put("received_at", Instant.ofEpochMilli(r.receivedAt).toString())
            put("duration_seconds", r.durationSeconds ?: JSONObject.NULL)
            put("prerecorded", r.prerecorded ?: JSONObject.NULL)
            put("forwarded_7726", r.forwarded7726)
            put("device_id", prefs.deviceId)
            r.audioPath?.let { path ->
                val f = java.io.File(path)
                if (f.exists()) { put("audio_base64", android.util.Base64.encodeToString(f.readBytes(), android.util.Base64.NO_WRAP)); put("audio_mime", r.audioMime ?: "audio/mp4") }
            }
        })
        val body = JSONObject().put("reports", arr).toString().toRequestBody(json)
        http.newCall(req("/api/reports").post(body).build()).execute().use { res ->
            val text = res.body?.string() ?: ""
            if (!res.isSuccessful) throw ApiException("HTTP ${res.code}: ${text.take(200)}")
            val results = JSONObject(text).getJSONArray("results")
            return (0 until results.length()).map { i ->
                val o = results.getJSONObject(i); o.getString("id") to o.getBoolean("created")
            }
        }
    }

    fun listReports(limit: Int = 100): List<ReportedItem> {
        http.newCall(req("/api/reports?limit=$limit").get().build()).execute().use { res ->
            val text = res.body?.string() ?: ""
            if (!res.isSuccessful) throw ApiException("HTTP ${res.code}: ${text.take(200)}")
            val arr = JSONObject(text).getJSONArray("reports")
            return (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                val comps = o.optJSONArray("complaints") ?: JSONArray()
                val claim = o.optJSONObject("claim")
                ReportedItem(
                    id = o.getString("id"),
                    kind = o.getString("kind"),
                    sender = o.getString("sender_phone"),
                    body = o.optString("body", null),
                    receivedAt = o.getString("received_at"),
                    status = o.getString("status"),
                    entityName = o.optString("entity_name", null).takeIf { !o.isNull("entity_name") },
                    category = o.optString("category", null).takeIf { !o.isNull("category") },
                    isMarketing = if (o.isNull("is_marketing")) null else o.getBoolean("is_marketing"),
                    complaints = (0 until comps.length()).map { j -> comps.getJSONObject(j).let { it.getString("agency") to it.getString("status") } },
                    claimStatus = claim?.optString("status"),
                    claimViolations = claim?.optInt("violation_count"),
                    claimMinCents = claim?.optLong("estimated_min_cents"),
                    claimMaxCents = claim?.optLong("estimated_max_cents"),
                )
            }
        }
    }

    fun health(): Boolean {
        http.newCall(req("/api/reports?limit=1").get().build()).execute().use { return it.isSuccessful }
    }

    fun runDaily(): String {
        http.newCall(req("/api/cron/daily").get().build()).execute().use { return "${it.code} ${it.body?.string()?.take(300)}" }
    }
}

class ApiException(msg: String) : Exception(msg)
