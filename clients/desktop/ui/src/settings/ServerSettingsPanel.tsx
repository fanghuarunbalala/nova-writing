/**
 * Server 设置面板（docs/PRD/桌面接入-数据通道server化.md FR1）：
 * - 登录（双令牌入 safeStorage 加密文件，面板不接触令牌本体）——server 地址固定
 *   （构建期注入，客户端固定server PRD FR3）：地址输入已退役，登录目标 = 构建期注入
 *   > 已保存配置地址 > fallback 常量（注入压过 saved：僵尸 url 无界面可修）；
 * - 连接状态指示（未配置 / 在线 / 离线 / 需重登）+ 当前 server 只读展示；
 * - 设备会话管理（列表 / 踢出）。
 * 纯云端化 ⑥：项目数据都在 server 上——未配置/离线时无法打开云端项目（重新登录即可恢复）。
 */
import { useCallback, useEffect, useState } from "react";
import { LogIn, LogOut, RefreshCw, ShieldOff } from "lucide-react";
import type { ServerAuthState, ServerDeviceInfo } from "@novel/core";
import type { ApplicationConfigurationClient } from "./ApplicationConfigurationClient.js";
import { useDefaultServerUrl, useInjectedServerUrl } from "../shared/DefaultServerUrlContext.js";

/** fallback：本机自托管 server（与 LoginPage 一致） */
const FALLBACK_SERVER_URL = "http://127.0.0.1:8787";

export interface ServerSettingsPanelProps {
  readonly configuration: ApplicationConfigurationClient;
}

const STATUS_LABEL: Record<ServerAuthState["status"], string> = {
  unconfigured: "未配置（登录后使用云端项目）",
  online: "在线",
  offline: "离线（server 不可达，恢复后即可继续）",
};

export function ServerSettingsPanel({ configuration }: ServerSettingsPanelProps) {
  const [state, setState] = useState<ServerAuthState>({ status: "unconfigured" });
  const defaultServerUrl = useDefaultServerUrl(FALLBACK_SERVER_URL);
  const injectedServerUrl = useInjectedServerUrl();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [devices, setDevices] = useState<readonly ServerDeviceInfo[]>([]);
  const [status, setStatus] = useState("正在读取状态…");
  const [busy, setBusy] = useState(false);

  const refreshAuth = useCallback(async () => {
    if (configuration.serverAuth === undefined) return;
    const next = await configuration.serverAuth();
    if (next === undefined) return;
    setState(next);
    setStatus(next.needRelogin === true ? "登录已失效，请重新登录" : (STATUS_LABEL[next.status] ?? next.status));
  }, [configuration]);

  const refreshDevices = useCallback(async () => {
    if (configuration.serverDevices === undefined || state.username === undefined) {
      setDevices([]);
      return;
    }
    try {
      const rows = await configuration.serverDevices();
      if (rows !== undefined) setDevices(rows);
    } catch {
      setDevices([]);
    }
  }, [configuration, state.username]);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);
  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  const login = async (): Promise<void> => {
    if (configuration.serverLogin === undefined) return;
    // 登录目标（v0.1 修正）：构建期注入 > 已保存配置 > fallback（地址输入已退役，
    // 旧配置僵尸 url 无界面可修；换目标 = 重新构建）
    const target = (injectedServerUrl ?? state.url ?? FALLBACK_SERVER_URL).trim();
    if (!/^https?:\/\/.+/.test(target)) {
      setStatus("服务器地址配置无效（需 http/https URL）");
      return;
    }
    setBusy(true);
    try {
      await configuration.serverLogin(target, username.trim(), password);
      setPassword("");
      setStatus("登录成功");
      await refreshAuth();
      await refreshDevices();
    } catch (error) {
      setStatus(`登录失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const logout = async (): Promise<void> => {
    if (configuration.serverLogout === undefined) return;
    setBusy(true);
    try {
      await configuration.serverLogout();
      setDevices([]);
      setStatus("已登出——重新登录即可打开你的云端项目");
      await refreshAuth();
    } catch (error) {
      setStatus(`登出失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const kick = async (deviceId: string): Promise<void> => {
    if (configuration.serverKickDevice === undefined) return;
    setBusy(true);
    try {
      await configuration.serverKickDevice(deviceId);
      await refreshDevices();
      await refreshAuth();
    } catch (error) {
      setStatus(`踢出失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const connected = state.status === "online" && state.username !== undefined;

  return (
    <section className="novel-model-settings" aria-label="Server 设置">
      <header className="novel-model-settings-header">
        <h3>Server（可选）</h3>
      </header>
      <p className="novel-set-hint">
        配置数据层 server 后，会话数据实时上推（手机等其它设备可查看进度并接续）；不配置则完全本地。
        服务器上还没有账号时，请先在 server 侧注册。
      </p>
      <div className="novel-set-section">
        <p className="novel-set-hint">
          状态：<strong>{status}</strong>
          {state.username !== undefined ? `（${state.username}）` : null}
        </p>
        <p className="novel-set-hint">
          server：<strong>{(injectedServerUrl ?? state.url ?? defaultServerUrl).replace(/\/+$/, "")}</strong>（固定，随构建分发）
        </p>
      </div>
      {connected ? (
        <div className="novel-save-bar">
          <button className="novel-set-btn" type="button" onClick={() => void logout()} disabled={busy}>
            <LogOut size={12} aria-hidden /> 登出
          </button>
          <button className="novel-set-btn" type="button" onClick={() => void refreshDevices()} disabled={busy}>
            <RefreshCw size={12} aria-hidden /> 刷新设备
          </button>
        </div>
      ) : (
        <div>
          <div className="novel-set-field">
            <label className="novel-set-hint">
              用户名
              <input className="novel-set-input" value={username} onChange={(event) => setUsername(event.target.value)} />
            </label>
          </div>
          <div className="novel-set-field">
            <label className="novel-set-hint">
              密码
              <input
                className="novel-set-input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          </div>
          <div className="novel-save-bar">
            <button className="novel-set-btn" type="button" onClick={() => void login()} disabled={busy}>
              <LogIn size={12} aria-hidden /> 登录
            </button>
          </div>
        </div>
      )}
      {connected && devices.length > 0 ? (
        <div className="novel-set-section">
          <p className="novel-set-hint">设备会话</p>
          {devices.map((device) => (
            <article className="novel-agent-card" key={device.id}>
              <header className="novel-agent-head">
                <span>
                  {device.name}
                  {device.id === state.deviceId ? "（本机）" : ""}
                  {device.active_sessions > 0 ? " · 在线" : " · 离线"}
                </span>
                {device.id !== state.deviceId ? (
                  <button className="novel-set-btn" type="button" onClick={() => void kick(device.id)} disabled={busy}>
                    <ShieldOff size={12} aria-hidden /> 踢出
                  </button>
                ) : null}
              </header>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
