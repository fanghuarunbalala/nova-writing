package nova.agent.net.mirror

import nova.agent.model.LLMessage
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class JournalMirrorTest {

    private fun tmpDir() = Files.createTempDirectory("nova-mirror")

    private fun row(gs: Long, runSeq: Int = 1, kind: String = "append") = MirrorRow(
        seq = runSeq, kind = kind,
        messages = listOf(LLMessage.User("m$gs")),
        ts = 0, gs = gs,
    )

    @Test
    fun tailScanFindsLastIntactRowAndSkipsGarbage() {
        val dir = tmpDir()
        val path = dir.resolve("journal.jsonl")
        Files.writeString(path, JournalMirror.json.encodeToString(MirrorRow.serializer(), row(1)) + "\n")
        Files.writeString(path, JournalMirror.json.encodeToString(MirrorRow.serializer(), row(2)) + "\n", java.nio.file.StandardOpenOption.APPEND)
        Files.writeString(path, """{"seq":3,"kind":"append","messages":[{"type":"user","content":"半行"""", java.nio.file.StandardOpenOption.APPEND) // 末尾断行

        val tail = JournalMirror.readMirrorTail(path)
        assertEquals(2, tail.gs)
        assertEquals(1, tail.runSeq)
    }

    @Test
    fun appendDedupesByStrictlyGreaterGs() {
        val dir = tmpDir()
        val path = dir.resolve("journal.jsonl")
        assertEquals(2, JournalMirror.appendMirrorRows(path, listOf(row(1), row(2))))
        // gs ≤ 尾序的行丢弃（多写者竞态安全：同 gs 只落一次）
        assertEquals(0, JournalMirror.appendMirrorRows(path, listOf(row(2), row(2))))
        assertEquals(1, JournalMirror.appendMirrorRows(path, listOf(row(2), row(3))))
        assertEquals(3, JournalMirror.readAllRows(path).size)
        assertEquals(3, JournalMirror.readMirrorTail(path).gs)
    }

    @Test
    fun rewriteReplacesWholeFile() {
        val dir = tmpDir()
        val path = dir.resolve("journal.jsonl")
        JournalMirror.appendMirrorRows(path, listOf(row(1), row(2), row(3)))
        JournalMirror.rewriteMirrorRows(path, listOf(row(7, runSeq = 9, kind = "snapshot")))
        val rows = JournalMirror.readAllRows(path)
        assertEquals(1, rows.size)
        assertEquals(9, rows[0].seq)
        assertEquals(7, rows[0].gs)
    }

    @Test
    fun mirrorRowsOfParsesPayloadStringAndFiltersKinds() {
        val events = listOf(
            ReplayRow(seq = 1, runSeq = 1, kind = "snapshot", payload = """[{"type":"user","content":"开号"}]""", definitionVersion = "1.0.0"),
            ReplayRow(seq = 2, runSeq = 1, kind = "append", payload = """[{"type":"assistant","content":"回复","finishReason":"STOP"}]"""),
            ReplayRow(seq = 3, runSeq = -1, kind = "domain-mutation", payload = """[{"foo":1}]"""), // 不入镜像
            ReplayRow(seq = 4, runSeq = 1, kind = "append", payload = """not-json["""), // 坏行跳过
        )
        val rows = JournalMirror.mirrorRowsOf(events) { 42L }
        assertEquals(2, rows.size)
        assertEquals("开号", (rows[0].messages[0] as nova.agent.model.LLMessage.User).content)
        assertEquals("1.0.0", rows[0].definitionVersion)
        assertEquals(42L, rows[0].ts)
        assertTrue(rows.none { it.gs == 3L || it.gs == 4L })
    }
}
