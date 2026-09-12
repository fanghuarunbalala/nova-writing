package nova.agent.app.di

import android.util.Log
import nova.agent.app.BuildConfig

/**
 * 诊断日志（真机验证「发送无响应」引入）：单 tag `NovaDiag`，lambda 惰性求值，
 * release 编译期整行消除。约定前缀：Send/Open/Lease/Run/Build/Repo/Auth/FGS/Event。
 *
 * 用法：`D { "Send text=${text.take(12)} active=$cid" }`
 */
inline fun D(msg: () -> String) {
    if (BuildConfig.DEBUG) Log.d("NovaDiag", msg())
}
