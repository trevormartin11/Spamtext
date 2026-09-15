package com.spamtext.app

import android.content.Context
import java.util.UUID

/** Simple settings store. Single user, single device. */
class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("spamtext", Context.MODE_PRIVATE)

    var baseUrl: String
        get() = sp.getString("baseUrl", "") ?: ""
        set(v) = sp.edit().putString("baseUrl", v.trim().trimEnd('/')).apply()

    var apiKey: String
        get() = sp.getString("apiKey", "") ?: ""
        set(v) = sp.edit().putString("apiKey", v.trim()).apply()

    var auto7726: Boolean
        get() = sp.getBoolean("auto7726", true)
        set(v) = sp.edit().putBoolean("auto7726", v).apply()

    var notifyUnknown: Boolean
        get() = sp.getBoolean("notifyUnknown", true)
        set(v) = sp.edit().putBoolean("notifyUnknown", v).apply()

    val deviceId: String
        get() = sp.getString("deviceId", null) ?: UUID.randomUUID().toString().also { sp.edit().putString("deviceId", it).apply() }

    val configured: Boolean get() = baseUrl.startsWith("http") && apiKey.isNotBlank()

    /** Numbers whose spam has already been reported from this device (so the list can show it). */
    fun markReported(key: String) = sp.edit().putStringSet("reported", (reportedKeys() + key).toList().takeLast(2000).toSet()).apply()
    fun reportedKeys(): Set<String> = sp.getStringSet("reported", emptySet()) ?: emptySet()

    /** FIFO of sender numbers awaiting the 7726 "reply with the number" prompt. */
    fun pending7726(): List<String> = (sp.getString("pending7726", "") ?: "").split('\n').filter { it.isNotBlank() }
    fun push7726(number: String) = sp.edit().putString("pending7726", (pending7726() + number).joinToString("\n")).apply()
    fun pop7726(): String? {
        val list = pending7726()
        if (list.isEmpty()) return null
        sp.edit().putString("pending7726", list.drop(1).joinToString("\n")).apply()
        return list.first()
    }
}
