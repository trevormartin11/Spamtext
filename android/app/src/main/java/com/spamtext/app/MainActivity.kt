package com.spamtext.app

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Message
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.spamtext.app.data.ApiClient
import com.spamtext.app.data.CallLogReader
import com.spamtext.app.data.Candidate
import com.spamtext.app.data.ReportPayload
import com.spamtext.app.data.ReportedItem
import com.spamtext.app.data.SmsReader
import com.spamtext.app.ui.Fmt
import com.spamtext.app.work.ReportWorker
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val PERMS = arrayOf(
    Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS, Manifest.permission.SEND_SMS,
    Manifest.permission.READ_CONTACTS, Manifest.permission.READ_CALL_LOG, Manifest.permission.POST_NOTIFICATIONS,
)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme { App() } }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun App() {
    val ctx = LocalContext.current
    val prefs = remember { Prefs(ctx) }
    var tab by remember { mutableStateOf(if (prefs.configured) 0 else 3) }
    var granted by remember { mutableStateOf(PERMS.all { ContextCompat.checkSelfPermission(ctx, it) == PackageManager.PERMISSION_GRANTED }) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { res ->
        granted = res.filterKeys { it != Manifest.permission.POST_NOTIFICATIONS }.values.all { it }
    }
    LaunchedEffect(Unit) { if (!granted) launcher.launch(PERMS) }

    Scaffold(
        topBar = { TopAppBar(title = { Text("Spamtext") }) },
        bottomBar = {
            NavigationBar {
                NavigationBarItem(selected = tab == 0, onClick = { tab = 0 }, icon = { Icon(Icons.Filled.Message, null) }, label = { Text("Texts") })
                NavigationBarItem(selected = tab == 1, onClick = { tab = 1 }, icon = { Icon(Icons.Filled.Call, null) }, label = { Text("Calls") })
                NavigationBarItem(selected = tab == 2, onClick = { tab = 2 }, icon = { Icon(Icons.Filled.CheckCircle, null) }, label = { Text("Reported") })
                NavigationBarItem(selected = tab == 3, onClick = { tab = 3 }, icon = { Icon(Icons.Filled.Settings, null) }, label = { Text("Settings") })
            }
        },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            if (!granted && tab != 3) {
                Card(Modifier.padding(12.dp).fillMaxWidth()) {
                    Column(Modifier.padding(12.dp)) {
                        Text("Permissions needed", style = MaterialTheme.typography.titleMedium)
                        Text("SMS (find the sender of a shared text, forward to 7726), Contacts (skip people you know), Call log (robocalls).")
                        Button(onClick = { launcher.launch(PERMS) }, Modifier.padding(top = 8.dp)) { Text("Grant") }
                    }
                }
            }
            when (tab) {
                0 -> TextsTab(prefs, granted)
                1 -> CallsTab(prefs, granted)
                2 -> ReportedTab(prefs)
                else -> SettingsTab(prefs)
            }
        }
    }
}

@Composable
private fun TextsTab(prefs: Prefs, granted: Boolean) {
    val ctx = LocalContext.current
    var items by remember { mutableStateOf<List<Candidate>>(emptyList()) }
    var reported by remember { mutableStateOf(prefs.reportedKeys()) }
    var selected by remember { mutableStateOf(setOf<String>()) }
    LaunchedEffect(granted) { if (granted) items = withContext(Dispatchers.IO) { SmsReader(ctx).recentFromUnknown(System.currentTimeMillis() - 90L * 86400_000) } }

    Column {
        Text("Texts from numbers not in your contacts (90 days). Tap Report, or select several and report at once. Easiest of all: share any text to “Report spam”, or tap Report on the notification.",
            Modifier.padding(12.dp), style = MaterialTheme.typography.bodySmall)
        if (selected.isNotEmpty()) Row(Modifier.padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = {
                val picks = items.filter { it.key in selected }
                ReportWorker.enqueue(ctx, picks.map { ReportPayload(it.kind, it.sender, it.body, it.receivedAt) })
                reported = reported + picks.map { it.key }; selected = emptySet()
            }) { Text("Report ${selected.size}") }
            OutlinedButton(onClick = { selected = emptySet() }) { Text("Clear") }
        }
        Row(Modifier.padding(horizontal = 12.dp)) {
            OutlinedButton(onClick = { selected = items.filter { it.key !in reported }.map { it.key }.toSet() }) { Text("Select all unreported") }
        }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(items, key = { it.key }) { c ->
                val done = c.key in reported
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp)) {
                        Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                            Text(Fmt.phone(c.sender), style = MaterialTheme.typography.titleSmall)
                            Text(Fmt.dateTime(c.receivedAt), style = MaterialTheme.typography.bodySmall)
                        }
                        Text(c.body ?: "", style = MaterialTheme.typography.bodyMedium, maxLines = 4)
                        Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (done) AssistChip(onClick = {}, label = { Text("Reported") })
                            else {
                                Button(onClick = { ReportWorker.enqueue(ctx, listOf(ReportPayload("sms", c.sender, c.body, c.receivedAt))); reported = reported + c.key }) { Text("Report") }
                                FilterChip(selected = c.key in selected, onClick = { selected = if (c.key in selected) selected - c.key else selected + c.key }, label = { Text("Select") })
                            }
                        }
                    }
                }
            }
            if (items.isEmpty()) item { Text(if (granted) "No texts from unknown numbers in the last 90 days." else "Grant permissions to list texts.", Modifier.padding(12.dp)) }
        }
    }
}

@Composable
private fun CallsTab(prefs: Prefs, granted: Boolean) {
    val ctx = LocalContext.current
    var items by remember { mutableStateOf<List<Candidate>>(emptyList()) }
    var reported by remember { mutableStateOf(prefs.reportedKeys()) }
    var asking by remember { mutableStateOf<Candidate?>(null) }
    LaunchedEffect(granted) { if (granted) items = withContext(Dispatchers.IO) { CallLogReader(ctx).recentFromUnknown(System.currentTimeMillis() - 60L * 86400_000) } }

    asking?.let { c ->
        RecordedDialogInline(onPick = { pre ->
            ReportWorker.enqueue(ctx, listOf(ReportPayload(c.kind, c.sender, null, c.receivedAt, c.durationSeconds, pre)))
            reported = reported + c.key; asking = null
        }, onDismiss = { asking = null })
    }
    Column {
        Text("Calls from numbers not in your contacts (60 days). Recorded-voice calls are worth $500–$1,500 each on their own. For a voicemail, share the recording from your voicemail app to “Report spam”.",
            Modifier.padding(12.dp), style = MaterialTheme.typography.bodySmall)
        LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(items, key = { it.key }) { c ->
                Card(Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(12.dp).fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Column {
                            Text(Fmt.phone(c.sender), style = MaterialTheme.typography.titleSmall)
                            Text("${Fmt.dateTime(c.receivedAt)} · ${c.kind} · ${c.durationSeconds ?: 0}s", style = MaterialTheme.typography.bodySmall)
                        }
                        if (c.key in reported) AssistChip(onClick = {}, label = { Text("Reported") }) else Button(onClick = { asking = c }) { Text("Report") }
                    }
                }
            }
            if (items.isEmpty()) item { Text(if (granted) "No calls from unknown numbers in the last 60 days." else "Grant permissions to list calls.", Modifier.padding(12.dp)) }
        }
    }
}

@Composable
private fun RecordedDialogInline(onPick: (Boolean?) -> Unit, onDismiss: () -> Unit) {
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Was it a recorded voice?") },
        text = { Text("Prerecorded or robotic voice calls are separately illegal and don't need the Do Not Call registry.") },
        confirmButton = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { onPick(true) }) { Text("Recorded") }
                OutlinedButton(onClick = { onPick(false) }) { Text("Live") }
                OutlinedButton(onClick = { onPick(null) }) { Text("Not sure") }
            }
        },
    )
}

@Composable
private fun ReportedTab(prefs: Prefs) {
    var items by remember { mutableStateOf<List<ReportedItem>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var tick by remember { mutableStateOf(0) }
    LaunchedEffect(tick) {
        if (!prefs.configured) { error = "Not configured"; return@LaunchedEffect }
        try { items = withContext(Dispatchers.IO) { ApiClient(prefs).listReports() }; error = null } catch (e: Exception) { error = e.message }
    }
    Column {
        Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { tick++ }) { Text("Refresh") }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
        if (items == null && error == null) CircularProgressIndicator(Modifier.padding(12.dp))
        LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(items ?: emptyList(), key = { it.id }) { r ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(r.entityName ?: Fmt.phone(r.sender), style = MaterialTheme.typography.titleSmall)
                            Text(r.status.replace('_', ' '), style = MaterialTheme.typography.bodySmall)
                        }
                        Text("${r.kind} · ${r.receivedAt.take(10)}${r.category?.let { " · $it" } ?: ""}${if (r.isMarketing == false) " · not marketing" else ""}", style = MaterialTheme.typography.bodySmall)
                        r.body?.let { Text(it, maxLines = 2, style = MaterialTheme.typography.bodyMedium) }
                        if (r.complaints.isNotEmpty()) Text(r.complaints.joinToString("  ") { "${it.first.uppercase()}: ${it.second}" }, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp))
                        r.claimStatus?.let {
                            Text("Claim: ${it.replace('_', ' ')} · ${r.claimViolations} violation(s) · ${Fmt.dollars(r.claimMinCents ?: 0)}–${Fmt.dollars(r.claimMaxCents ?: 0)}",
                                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 4.dp))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SettingsTab(prefs: Prefs) {
    var url by remember { mutableStateOf(prefs.baseUrl) }
    var key by remember { mutableStateOf(prefs.apiKey) }
    var auto by remember { mutableStateOf(prefs.auto7726) }
    var notif by remember { mutableStateOf(prefs.notifyUnknown) }
    var msg by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        OutlinedTextField(value = url, onValueChange = { url = it }, label = { Text("Server URL (Vercel)") }, placeholder = { Text("https://spamtext.vercel.app") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        OutlinedTextField(value = key, onValueChange = { key = it }, label = { Text("API key (APP_API_KEY)") }, modifier = Modifier.fillMaxWidth(), singleLine = true, visualTransformation = PasswordVisualTransformation())
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text("Forward texts to 7726 (AT&T) automatically"); Switch(checked = auto, onCheckedChange = { auto = it }) }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text("Notify with Report button for unknown senders"); Switch(checked = notif, onCheckedChange = { notif = it }) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = {
                prefs.baseUrl = url; prefs.apiKey = key; prefs.auto7726 = auto; prefs.notifyUnknown = notif
                scope.launch { msg = try { if (withContext(Dispatchers.IO) { ApiClient(prefs).health() }) "Saved. Connected ✓" else "Saved, but the server rejected the key." } catch (e: Exception) { "Saved, but connection failed: ${e.message}" } }
            }) { Text("Save & test") }
            OutlinedButton(onClick = { scope.launch { msg = try { withContext(Dispatchers.IO) { ApiClient(prefs).runDaily() } } catch (e: Exception) { e.message ?: "error" } } }) { Text("Run pipeline now") }
        }
        Text(msg)
        Spacer(Modifier.height(8.dp))
        Text("How it works", style = MaterialTheme.typography.titleMedium)
        Text("1. A text from an unknown number arrives → notification with a Report button (or share it to “Report spam”).\n2. This app forwards it to 7726 and uploads it.\n3. The server identifies the sender, files FTC / FCC / Do Not Call complaints, and tracks a TCPA claim.\n4. When a claim is viable it drafts a demand letter, holds it for 24h so you can cancel in Telegram, then mails it certified.\n5. No response in 30 days → a small-claims packet for Arizona Justice Court is generated.", style = MaterialTheme.typography.bodySmall)
    }
}
