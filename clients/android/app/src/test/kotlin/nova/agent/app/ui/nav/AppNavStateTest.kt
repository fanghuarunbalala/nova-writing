package nova.agent.app.ui.nav

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** 返回键优先级（sheet > 抽屉 > 路由栈 > 退出）纯函数判定（PRD FR13） */
class AppNavStateTest {

    @Test
    fun `全关时交系统退出`() {
        assertNull(backTarget(sheetExpanded = false, drawerOpen = false, stackDepth = 0))
    }

    @Test
    fun `sheet 最高优先`() {
        assertEquals(BackTarget.CLOSE_SHEET, backTarget(true, drawerOpen = true, stackDepth = 2))
    }

    @Test
    fun `其次抽屉`() {
        assertEquals(BackTarget.CLOSE_DRAWER, backTarget(false, drawerOpen = true, stackDepth = 2))
    }

    @Test
    fun `最后路由栈`() {
        assertEquals(BackTarget.POP_ROUTE, backTarget(false, drawerOpen = false, stackDepth = 1))
        assertEquals(BackTarget.POP_ROUTE, backTarget(false, drawerOpen = false, stackDepth = 3))
    }

    @Test
    fun `路由栈空时不拦截`() {
        assertNull(backTarget(false, drawerOpen = false, stackDepth = 0))
    }
}
