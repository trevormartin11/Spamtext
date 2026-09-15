package com.spamtext.app.data

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.ContactsContract
import androidx.core.content.ContextCompat

/** Cached "is this number one of my contacts" check. */
class Contacts(private val context: Context) {
    private val cache = HashMap<String, Boolean>()

    fun isContact(number: String): Boolean {
        if (number.isBlank()) return false
        cache[number]?.let { return it }
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) return false
        val uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number))
        val found = try {
            context.contentResolver.query(uri, arrayOf(ContactsContract.PhoneLookup._ID), null, null, null)?.use { it.count > 0 } ?: false
        } catch (_: Exception) { false }
        cache[number] = found
        return found
    }
}
