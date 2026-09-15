package com.spamtext.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.spamtext.app.data.CallLogReader
import com.spamtext.app.data.Candidate
import com.spamtext.app.data.ReportPayload
import com.spamtext.app.data.SmsReader
import com.spamtext.app.ui.Fmt
import com.spamtext.app.work.ReportWorker

/**
 * Share-sheet target. Google Messages shares only the message text, so we look the message up in the
 * SMS inbox to recover the sender and timestamp. Audio shares (voicemail apps) are attached to a recent call.
 */
class ShareReceiverActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = Prefs(this)
        if (!prefs.configured) {
            Toast.makeText(this, "Set up Spamtext first (server URL + API key)", Toast.LENGTH_LONG).show()
            startActivity(Intent(this, MainActivity::class.java)); finish(); return
        }
        if (!hasPermissions()) {
            Toast.makeText(this, "Open Spamtext once to grant SMS permission", Toast.LENGTH_LONG).show()
            startActivity(Intent(this, MainActivity::class.java)); finish(); return
        }
        val type = intent.type ?: ""
        when {
            type.startsWith("audio/") -> handleAudio(androidx.core.content.IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java), type)
            else -> handleText(intent.getStringExtra(Intent.EXTRA_TEXT) ?: "")
        }
    }

    private fun hasPermissions(): Boolean =
        checkSelfPermission(android.Manifest.permission.READ_SMS) == android.content.pm.PackageManager.PERMISSION_GRANTED

    private fun handleText(text: String) {
        if (text.isBlank()) { finish(); return }
        val matches = SmsReader(this).findByBody(text)
        if (matches.size == 1) { submit(listOf(matches[0].toPayload())); return }
        // Zero or ambiguous: ask which sender it was.
        val recent = SmsReader(this).recentFromUnknown(System.currentTimeMillis() - 30L * 86400_000)
            .distinctBy { it.sender }.take(15)
        val options = (matches.ifEmpty { recent })
        if (options.isEmpty()) {
            // Nothing in the inbox at all (maybe RCS): report with sender unknown, the text still gets filed.
            submit(listOf(ReportPayload("sms", "unknown", text, System.currentTimeMillis()))); return
        }
        setContent {
            MaterialTheme {
                Picker(title = "Who sent this?", options = options, sub = { it.body?.take(60) ?: "" }) { c ->
                    submit(listOf(ReportPayload("sms", c.sender, text, if (matches.isNotEmpty()) c.receivedAt else System.currentTimeMillis())))
                }
            }
        }
    }

    private fun handleAudio(uri: Uri?, mime: String) {
        if (uri == null) { finish(); return }
        val bytes = try { contentResolver.openInputStream(uri)?.use { it.readBytes() } } catch (_: Exception) { null }
        if (bytes == null || bytes.size > 8_000_000) { Toast.makeText(this, "Could not read audio (max 8 MB)", Toast.LENGTH_LONG).show(); finish(); return }
        val file = java.io.File(cacheDir, "voicemail-${System.currentTimeMillis()}.bin").apply { writeBytes(bytes) }
        val calls = CallLogReader(this).recentFromUnknown(System.currentTimeMillis() - 30L * 86400_000).take(20)
        setContent {
            MaterialTheme {
                var chosen by remember { mutableStateOf<Candidate?>(null) }
                if (chosen == null) {
                    Picker(title = "Which call left this voicemail?", options = calls, sub = { Fmt.dateTime(it.receivedAt) }) { chosen = it }
                } else {
                    RecordedDialog { pre ->
                        val c = chosen!!
                        submit(listOf(ReportPayload("voicemail", c.sender, null, c.receivedAt, c.durationSeconds, pre,
                            audioPath = file.absolutePath, audioMime = mime)))
                    }
                }
            }
        }
    }

    private fun submit(payloads: List<ReportPayload>) {
        ReportWorker.enqueue(this, payloads)
        Toast.makeText(this, "Reporting ${payloads.first().sender}", Toast.LENGTH_SHORT).show()
        finish()
    }
}

private fun Candidate.toPayload() = ReportPayload(kind, sender, body, receivedAt, durationSeconds)

@androidx.compose.runtime.Composable
private fun Picker(title: String, options: List<Candidate>, sub: (Candidate) -> String, onPick: (Candidate) -> Unit) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    AlertDialog(
        onDismissRequest = { (ctx as? ComponentActivity)?.finish() },
        title = { Text(title) },
        text = {
            LazyColumn {
                items(options) { c ->
                    Column(Modifier.fillMaxWidth().clickable { onPick(c) }.padding(vertical = 8.dp)) {
                        Text(Fmt.phone(c.sender), style = MaterialTheme.typography.bodyLarge)
                        Text(sub(c), style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { (ctx as? ComponentActivity)?.finish() }) { Text("Cancel") } },
    )
}

@androidx.compose.runtime.Composable
fun RecordedDialog(onPick: (Boolean?) -> Unit) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    AlertDialog(
        onDismissRequest = { (ctx as? ComponentActivity)?.finish() },
        title = { Text("Was it a recorded voice?") },
        text = {
            Column {
                Text("Prerecorded or robotic voice calls are separately illegal (47 U.S.C. 227(b)) and don't need the Do Not Call registry.")
                Row(Modifier.padding(top = 12.dp)) {
                    FilterChip(selected = false, onClick = { onPick(true) }, label = { Text("Recorded") })
                    FilterChip(selected = false, onClick = { onPick(false) }, label = { Text("Live person") }, modifier = Modifier.padding(start = 8.dp))
                    FilterChip(selected = false, onClick = { onPick(null) }, label = { Text("Not sure") }, modifier = Modifier.padding(start = 8.dp))
                }
            }
        },
        confirmButton = {},
    )
}
