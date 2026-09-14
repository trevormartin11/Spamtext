package com.spamtext.app.receivers

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.widget.Toast
import com.spamtext.app.data.ReportPayload
import com.spamtext.app.work.ReportWorker

/** Handles the "Report spam" notification action without opening the app. */
class ReportActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_REPORT) return
        val sender = intent.getStringExtra("sender") ?: return
        val body = intent.getStringExtra("body")
        val ts = intent.getLongExtra("ts", System.currentTimeMillis())
        ReportWorker.enqueue(context, listOf(ReportPayload("sms", sender, body, ts)))
        context.getSystemService(NotificationManager::class.java).cancel(intent.getIntExtra("notifId", 0))
        Toast.makeText(context, "Reporting $sender", Toast.LENGTH_SHORT).show()
    }

    companion object { const val ACTION_REPORT = "com.spamtext.app.REPORT" }
}
