/**
 * LoginPage（独立登录页 · docs/design-demos/login-page-demo.html 定稿形态）
 *
 * 启动登录门 / 欢迎页入口共用：用户名 + 密码的单一主表单；底部次级入口「注册账号」
 * ——注册模式同卡切换（← 返回登录），注册成功即自动登录跳成功态；成功态展示
 * 用户名@server + 「进入工作台」。纯云端化 ⑥：强制登录——项目数据都在 server 上，
 * 无本地模式跳过入口。老 main 进程（无 serverLogin/serverRegister 方法）降级：
 * 注册入口隐藏、登录给出提示。
 *
 * 固定 server（客户端固定server PRD FR3）：地址输入已退役——登录目标 =
 * 构建期注入（DefaultServerUrlContext）> 已保存配置地址（config.json）> 本地 fallback。
 */
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Cloud, RefreshCw, Smartphone } from "lucide-react";
import type { ServerAuthState } from "@novel/core";
import type { ApplicationConfigurationClient } from "../settings/ApplicationConfigurationClient.js";
import { Button } from "../shared/primitives/Button.js";
import { Icon } from "../shared/primitives/Icon.js";
import { Input } from "../shared/primitives/Input.js";
import { useDefaultServerUrl, useInjectedServerUrl } from "../shared/DefaultServerUrlContext.js";
import styles from "./LoginPage.module.css";

/** fallback：本机自托管 server（cloud/server 缺省端口）——无构建期注入时兜底 */
const DEFAULT_SERVER_URL = "http://127.0.0.1:8787";
const URL_PATTERN = /^https?:\/\/[^\s/.][^\s]*$/;

/** 成功态只展示 host（协议+尾斜杠对用户是噪音；解析失败原样返回） */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/\/+$/, "");
  }
}

export interface LoginPageProps {
  readonly configuration: ApplicationConfigurationClient;
  /** 成功态「进入工作台」 */
  readonly onEnterWorkspace: () => void;
}

type Mode = "login" | "register";

const MODE_COPY: Record<Mode, { title: string; lede: string; submit: string; passHint: string }> = {
  login: {
    title: "登录同步服务",
    lede: "登录后，会话数据实时同步到你的 server——手机等其它设备可查看进度并接续写作。",
    submit: "登 录",
    passHint: "",
  },
  register: {
    title: "创建账号",
    lede: "在你的 server 上创建账号；注册成功后自动登录并开启同步。",
    submit: "注 册 并 登 录",
    passHint: "至少 8 位；建议混合字母与数字",
  },
};

export function LoginPage({ configuration, onEnterWorkspace }: LoginPageProps) {
  const [mode, setMode] = useState<Mode>("login");
  const defaultServerUrl = useDefaultServerUrl(DEFAULT_SERVER_URL);
  const injectedServerUrl = useInjectedServerUrl();
  const [savedUrl, setSavedUrl] = useState<string | undefined>(undefined);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [done, setDone] = useState<{ username: string; url: string } | undefined>(undefined);

  const seedFromState = useCallback((state: ServerAuthState) => {
    // 已保存的配置地址（登录成功后 config.json server.set 落库）——仅在无注入时兜底
    if (state.url !== undefined && state.url !== "") setSavedUrl(state.url);
    // 已在线（欢迎页入口重开等场景）：直接呈现成功态
    if (state.username !== undefined && state.status === "online") {
      setDone({ username: state.username, url: state.url ?? defaultServerUrl });
    }
  }, [defaultServerUrl]);

  useEffect(() => {
    const pending = configuration.serverAuth?.();
    if (pending === undefined) return;
    void pending.then((state) => {
      if (state !== undefined) seedFromState(state);
    });
  }, [configuration, seedFromState]);

  const canLogin = configuration.serverLogin !== undefined;
  const canRegister = configuration.serverRegister !== undefined;

  const submit = async (): Promise<void> => {
    const copy = MODE_COPY[mode];
    // 登录目标（v0.1 修正）：构建期注入 > 已保存配置 > fallback（地址输入已退役，
    // 旧配置的僵尸 url 无界面可修，注入必须压过；换目标 = 重新构建）
    const target = (injectedServerUrl ?? savedUrl ?? DEFAULT_SERVER_URL).trim();
    const trimmedUser = username.trim();
    if (!URL_PATTERN.test(target)) {
      setError("服务器地址配置无效（需 http/https URL）");
      return;
    }
    if (trimmedUser.length < 3) {
      setError(mode === "login" ? "请填写用户名" : "用户名需 3 – 32 字符");
      return;
    }
    if (mode === "register" && password.length < 8) {
      setError("密码至少 8 位");
      return;
    }
    if (password.length === 0) {
      setError("请填写密码");
      return;
    }
    const call = mode === "login" ? configuration.serverLogin : configuration.serverRegister;
    if (call === undefined) {
      setError("当前版本不支持该操作（请更新应用）");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const state = await call(target, trimmedUser, password);
      if (state === undefined) {
        setError("当前版本不支持该操作（请更新应用）");
        return;
      }
      setDone({ username: trimmedUser, url: target });
    } catch (cause) {
      // server 防枚举/校验文案（用户名或密码错误 / 用户名已存在 / 密码至少 8 位）原样呈现
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  // ---- 成功态 ----
  if (done !== undefined) {
    return (
      <div className={styles.page} aria-label="已连接同步服务">
        <div className={styles.card}>
          <div className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true">N</span>
            <span className={styles.brandName}>Nova Writing</span>
          </div>
          <div className={styles.successIcon} aria-hidden="true">✓</div>
          <h2 className={styles.successTitle}>已连接同步服务</h2>
          <p className={styles.successMeta}>
            <strong>{done.username}</strong>
            <span className={styles.mono}>@{hostOf(done.url)}</span>
          </p>
          <div className={styles.successNote}>
            · 本设备的会话数据将实时上推 server（journal / 审批 / 租约）
            <br />
            · 其它设备登录同账号即可查看进度并接续
            <br />
            · 连接状态与设备管理：设置 → Server
          </div>
          <Button variant="primary" size="lg" fullWidth onClick={onEnterWorkspace}>
            进入工作台
          </Button>
        </div>
      </div>
    );
  }

  // ---- 表单态 ----
  const copy = MODE_COPY[mode];
  return (
    <div className={`${styles.page} ${styles.split}`} aria-label="登录同步服务">
      {/* 宽窗口左侧品牌/价值区（<960px 隐藏，回落居中单卡）——消除大画布上的空旷感 */}
      <aside className={styles.hero} aria-hidden="true">
        <div className={styles.heroBrand}>
          <span className={styles.brandMark} aria-hidden="true">N</span>
          <span className={styles.brandName}>Nova Writing</span>
        </div>
        <p className={styles.heroTag}>把一桩旧事，写成一本新书——<br />现在，每一端都是同一本书。</p>
        <ul className={styles.heroPoints}>
          <li>
            <Icon icon={RefreshCw} size="sm" />
            <span>实时同步——会话数据上推你自己的 server</span>
          </li>
          <li>
            <Icon icon={Smartphone} size="sm" />
            <span>多端接续——手机查看进度、任意设备续写</span>
          </li>
          <li>
            <Icon icon={Cloud} size="sm" />
            <span>云端项目——数据都在你自己的 server 上，每一端看到同一本书</span>
          </li>
        </ul>
      </aside>
      <div className={styles.formSide}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">N</span>
          <div>
            <div className={styles.brandName}>Nova Writing</div>
            <div className={styles.brandTag}>写作同步 · 多端接续</div>
          </div>
        </div>

        <h1 className={styles.title}>{copy.title}</h1>
        <p className={styles.lede}>{copy.lede}</p>

        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          noValidate
        >
          <div className={styles.field}>
            <div className={styles.fieldLabel}>
              <label htmlFor="login-username">用户名</label>
            </div>
            <Input
              id="login-username"
              value={username}
              autoComplete="username"
              spellCheck={false}
              placeholder="3 – 32 字符"
              onChange={(event) => setUsername(event.currentTarget.value)}
            />
          </div>
          <div className={styles.field}>
            <div className={styles.fieldLabel}>
              <label htmlFor="login-password">密码</label>
            </div>
            <div className={styles.passwordWrap}>
              <Input
                id="login-password"
                type={showPassword ? "text" : "password"}
                value={password}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                placeholder={mode === "register" ? "至少 8 位" : "••••••••"}
                onChange={(event) => setPassword(event.currentTarget.value)}
              />
              <button
                type="button"
                className={styles.togglePassword}
                onClick={() => setShowPassword((prev) => !prev)}
              >
                {showPassword ? "隐藏" : "显示"}
              </button>
            </div>
            {copy.passHint !== "" ? <div className={styles.fieldHint}>{copy.passHint}</div> : null}
          </div>

          {error !== undefined ? (
            <div className={styles.errorBanner} role="alert">
              {error}
            </div>
          ) : null}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            fullWidth
            loading={busy}
            disabled={!canLogin}
            trailingIcon={<Icon icon={ArrowRight} size="sm" />}
          >
            {copy.submit}
          </Button>
        </form>

        {mode === "login" ? (
          <div className={styles.auxRow}>
            {canRegister ? (
              <button type="button" className={styles.registerLink} onClick={() => setMode("register")}>
                注册账号
              </button>
            ) : null}
          </div>
        ) : (
          <div className={styles.auxRow}>
            <button
              type="button"
              className={styles.backLink}
              onClick={() => {
                setMode("login");
                setError(undefined);
              }}
            >
              <Icon icon={ArrowLeft} size="sm" /> 返回登录
            </button>
          </div>
        )}

        <p className={styles.footnote}>
          令牌经系统安全存储（safeStorage）加密 · 模型 API Key 不上传（BYOK）
          <br />
          项目数据保存在你自己的 server 上，任何设备登录同一账号即可接续写作
        </p>
      </div>
      </div>
    </div>
  );
}
