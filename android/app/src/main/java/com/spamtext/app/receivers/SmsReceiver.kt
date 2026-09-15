package com.spamtext.app.receivers

import android.Manifest
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Telephony
import android.telephony.SmsManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.spamtext.app.MainActivity
import com.spamtext.app.Prefs
import com.spamtext.app.R
import com.spamtext.app.SpamtextApp
import com.spamtext.app.data.Contacts

/**
 * Two jobs:
 *  1. A text from a number not in contacts -> notification with a one-tap "Report spam" action.
 *  2. A reply from 7726 asking for the sender number -> answer automatically with the pending number.
 */
class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val msgs = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        if (msgs.isEmpty()) return
        val sender = msgs[0].displayOriginatingAddress ?: return
        val body = msgs.joinToString("") { it.messageBody ?: "" }
        val ts = msgs[0].timestampMillis.takeIf { it > 0 } ?: System.currentTimeMillis()
        val prefs = Prefs(context)

        if (sender == "7726" || sender.endsWith("7726")) {
            handleCarrierReply(context, prefs, body)
            return
        }
        if (!prefs.notifyUnknown || !prefs.configured) return
        if (Contacts(context).isContact(sender)) return
        showReportNotification(context, sender, body, ts)
    }

    private fun handleCarrierReply(context: Context, prefs: Prefs, body: String) {
        // AT&T: "...please reply with the phone number or email address the message came from..."
        val asksForNumber = body.contains("number", ignoreCase = true) && (body.contains("reply", ignoreCase = true) || body.contains("respond", ignoreCase = true))
        if (!asksForNumber) return
        val number = prefs.pop7726() ?: return
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) return
        try {
            context.getSystemService(SmsManager::class.java)?.sendTextMessage("7726", null, number, null, null)
        } catch (_: Exception) { }
    }

    private fun showReportNotification(context: Context, sender: String, body: String, ts: Long) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val id = (sender + ts).hashCode()
        val report = Intent(context, ReportActionReceiver::class.java).apply {
            action = ReportActionReceiver.ACTION_REPORT
            putExtra("sender", sender); putExtra("body", body); putExtra("ts", ts); putExtra("notifId", id)
        }
        val reportPi = PendingIntent.getBroadcast(context, id, report, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val open = PendingIntent.getActivity(context, id, Intent(context, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(context, SpamtextApp.CHANNEL_INCOMING)
            .setSmallIcon(R.drawable.ic_stat_report)
            .setContentTitle("Text from unknown number $sender")
            .setContentText(body.take(120))
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(open)
            .addAction(0, "Report spam", reportPi)
            .setAutoCancel(true)
            .setTimeoutAfter(6 * 60 * 60 * 1000L)
            .build()
        context.getSystemService(NotificationManager::class.java).notify(id, n)
    }
}
