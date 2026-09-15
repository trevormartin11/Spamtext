package com.spamtext.app.ui

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object Fmt {
    private val dt = SimpleDateFormat("MMM d, h:mm a", Locale.US)
    fun dateTime(ms: Long): String = dt.format(Date(ms))
    fun phone(p: String): String {
        val d = p.filter { it.isDigit() }
        return if (d.length == 11 && d.startsWith("1")) "(${d.substring(1, 4)}) ${d.substring(4, 7)}-${d.substring(7)}"
        else if (d.length == 10) "(${d.substring(0, 3)}) ${d.substring(3, 6)}-${d.substring(6)}" else p
    }
    fun dollars(cents: Long): String = "$" + String.format(Locale.US, "%,d", cents / 100)
}
