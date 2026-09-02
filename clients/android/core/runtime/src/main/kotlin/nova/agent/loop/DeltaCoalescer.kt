package nova.agent.loop

/**
 * delta 合并缓冲（桌面端 DELTA_COALESCE_MS = 32ms 尾窗合并对应物）。
 * 时钟可注入：单测用虚拟时钟（runTest 的 testScheduler::currentTime），确定性断言合并行为。
 *
 * 保序不变量由使用方保证：任何非 delta 事件发射前必须先 flush()。
 */
class DeltaCoalescer(
    private val windowMs: Long,
    private val clock: () -> Long,
    private val emit: suspend (String) -> Unit,
) {
    private val buffer = StringBuilder()
    private var lastEmit: Long = clock()

    suspend fun add(text: String) {
        buffer.append(text)
        if (clock() - lastEmit >= windowMs) flush()
    }

    suspend fun flush() {
        if (buffer.isNotEmpty()) {
            emit(buffer.toString())
            buffer.clear()
            lastEmit = clock()
        }
    }
}
