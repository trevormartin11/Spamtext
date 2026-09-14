package com.spamtext.app.data

import android.content.Context
import android.provider.Telephony

class SmsReader(private val context: Context) {
    private val contacts = Contacts(context)

    /** Inbox messages from senders that are not contacts, newest first. */
    fun recentFromUnknown(sinceMillis: Long, limit: Int = 300): List<Candidate> {
        val out = ArrayList<Candidate>()
        val proj = arrayOf(Telephony.Sms._ID, Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE)
        context.contentResolver.query(
            Telephony.Sms.Inbox.CONTENT_URI, proj, "${Telephony.Sms.DATE} > ?", arrayOf(sinceMillis.toString()), "${Telephony.Sms.DATE} DESC"
        )?.use { c ->
            val ia = c.getColumnIndex(Telephony.Sms.ADDRESS); val ib = c.getColumnIndex(Telephony.Sms.BODY); val id = c.getColumnIndex(Telephony.Sms.DATE)
            while (c.moveToNext() && out.size < limit) {
                val addr = c.getString(ia) ?: continue
                if (contacts.isContact(addr)) continue
                if (addr == "7726") continue
                out += Candidate("sms", addr, c.getString(ib), c.getLong(id))
            }
        }
        return out
    }

    /** Find the inbox message whose body matches the shared text (Google Messages shares only the body). */
    fun findByBody(body: String): List<Candidate> {
        val needle = body.trim()
        if (needle.isEmpty()) return emptyList()
        val out = ArrayList<Candidate>()
        val proj = arrayOf(Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE)
        context.contentResolver.query(
            Telephony.Sms.Inbox.CONTENT_URI, proj, "${Telephony.Sms.BODY} = ?", arrayOf(needle), "${Telephony.Sms.DATE} DESC"
        )?.use { c ->
            while (c.moveToNext() && out.size < 5) out += Candidate("sms", c.getString(0) ?: "", c.getString(1), c.getLong(2))
        }
        if (out.isEmpty()) {
            // Fallback: the share may include extra whitespace/newlines; try a LIKE on the first 40 chars.
            val head = needle.take(40).replace("%", "\\%").replace("_", "\\_")
            context.contentResolver.query(
                Telephony.Sms.Inbox.CONTENT_URI, proj, "${Telephony.Sms.BODY} LIKE ? ESCAPE '\\'", arrayOf("$head%"), "${Telephony.Sms.DATE} DESC"
            )?.use { c ->
                while (c.moveToNext() && out.size < 5) out += Candidate("sms", c.getString(0) ?: "", c.getString(1), c.getLong(2))
            }
        }
        return out.filter { it.sender.isNotBlank() }
    }
}
