package com.spamtext.app.data

/** A text or call the user may want to report. */
data class Candidate(
    val kind: String,            // sms | call | voicemail
    val sender: String,
    val body: String?,
    val receivedAt: Long,        // epoch millis
    val durationSeconds: Int? = null,
) {
    val key: String get() = "$kind|$sender|$receivedAt"
}

/** What the phone sends to POST /api/reports. */
data class ReportPayload(
    val kind: String,
    val sender: String,
    val body: String?,
    val receivedAt: Long,
    val durationSeconds: Int? = null,
    val prerecorded: Boolean? = null,
    val forwarded7726: Boolean = false,
    val audioPath: String? = null,   // local cache file with the voicemail recording
    val audioMime: String? = null,
)

data class ReportedItem(
    val id: String,
    val kind: String,
    val sender: String,
    val body: String?,
    val receivedAt: String,
    val status: String,
    val entityName: String?,
    val category: String?,
    val isMarketing: Boolean?,
    val complaints: List<Pair<String, String>>, // agency -> status
    val claimStatus: String?,
    val claimViolations: Int?,
    val claimMinCents: Long?,
    val claimMaxCents: Long?,
)
