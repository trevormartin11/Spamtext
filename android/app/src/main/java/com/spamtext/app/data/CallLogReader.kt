package com.spamtext.app.data

import android.content.Context
import android.provider.CallLog

class CallLogReader(private val context: Context) {
    private val contacts = Contacts(context)

    /** Incoming / missed / rejected / voicemail calls from non-contacts, newest first. */
    fun recentFromUnknown(sinceMillis: Long, limit: Int = 200): List<Candidate> {
        val out = ArrayList<Candidate>()
        val proj = arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.DATE, CallLog.Calls.DURATION, CallLog.Calls.TYPE)
        context.contentResolver.query(
            CallLog.Calls.CONTENT_URI, proj, "${CallLog.Calls.DATE} > ? AND ${CallLog.Calls.TYPE} != ?",
            arrayOf(sinceMillis.toString(), CallLog.Calls.OUTGOING_TYPE.toString()), "${CallLog.Calls.DATE} DESC"
        )?.use { c ->
            while (c.moveToNext() && out.size < limit) {
                val num = c.getString(0) ?: continue
                if (num.isBlank() || contacts.isContact(num)) continue
                val type = c.getInt(3)
                val kind = if (type == CallLog.Calls.VOICEMAIL_TYPE) "voicemail" else "call"
                out += Candidate(kind, num, null, c.getLong(1), c.getInt(2))
            }
        }
        return out
    }
}
