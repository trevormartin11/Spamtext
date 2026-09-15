package com.spamtext.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager

class SpamtextApp : Application() {
    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_INCOMING, getString(R.string.channel_incoming), NotificationManager.IMPORTANCE_DEFAULT)
                .apply { description = "One-tap report for texts from numbers not in your contacts" }
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_REPORTS, getString(R.string.channel_reports), NotificationManager.IMPORTANCE_LOW)
                .apply { description = "Upload progress and results" }
        )
    }

    companion object {
        const val CHANNEL_INCOMING = "incoming"
        const val CHANNEL_REPORTS = "reports"
    }
}
