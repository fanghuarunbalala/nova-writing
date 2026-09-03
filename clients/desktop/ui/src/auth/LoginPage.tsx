/**
 * LoginPage（独立登录页 · docs/design-demos/login-page-demo.html 定稿形态）
 *
 * 启动登录门 / 欢迎页入口共用：服务器地址（预填推荐默认）+ 用户名 + 密码的单一主表单；
 * 底部次级入口「暂不登录，本地模式使用 · 注册账号」——注册模式同卡切换（← 返回登录），
 * 注册成功即自动登录跳成功态；成功态展示 用户名@server + 「进入工作台」。
 * 老 main 进程（无 serverLogin/serverRegister 方法）降级：注册入口隐藏、登录给出提示。
 */
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { ServerAuthState } from "@novel/core";
import type { ApplicationConfigurationClient } from "../settings/ApplicationConfigurationClient.js";
import { Button } from "../shared/primitives/Button.js";
import { Icon } from "../shared/primitives/Icon.js";
import { Input } from "../shared/primitives/Input.js";
import styles from "./LoginPage.module.css";

/** 推荐默认：本机自托管 server（cloud/server 缺省端口） */
const DEFAULT_SERVER_URL = "http://127.0.0.1:8787";
const URL_PATTERN = /^https?:\/\/[^\s/.][^\s]*$/;

export interface LoginPageProps {
  readonly configuration: ApplicationConfigurationClient;
  /** 「暂不登录，本地模式使用」——由宿主记住跳过并关闭登录门 */
  readonly onSkip: () => void;
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

export function LoginPage({ configuration, onSkip, onEnterWorkspace }: LoginPageProps) {
  const [mode, setMode] = useState<Mode>("login");
  const [url, setUrl] = useState(DEFAULT_SERVER_URL);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [done, setDone] = useState<{ username: string; url: string } | undefined>(undefined);

  const seedFromState = useCallback((state: ServerAuthState) => {
    if (state.url !== undefined && state.url !== "") setUrl(state.url);
    // 已在线（欢迎页入口重开等场景）：直接呈现成功态
    if (state.username !== undefined && state.status === "online") {
      setDone({ username: state.username, url: state.url ?? url });
    }
  }, [url]);

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
    const trimmedUrl = url.trim();
    const trimmedUser = username.trim();
    if (!URL_PATTERN.test(trimmedUrl)) {
      setError("服务器地址需为 http/https URL");
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
      const state = await call(trimmedUrl, trimmedUser, password);
      if (state === undefined) {
        setError("当前版本不支持该操作（请更新应用）");
        return;
      }
      setDone({ username: trimmedUser, url: trimmedUrl });
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
            <span className={styles.mono}>@{done.url.replace(/\/+$/, "")}</span>
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
    <div className={styles.page} aria-label="登录同步服务">
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
              <label htmlFor="login-server-url">服务器地址</label>
              <span className={styles.badge}>推荐 · 本机默认</span>
            </div>
            <Input
              id="login-server-url"
              className={styles.mono}
              value={url}
              spellCheck={false}
              placeholder={DEFAULT_SERVER_URL}
              onChange={(event) => setUrl(event.currentTarget.value)}
            />
            <div className={styles.fieldHint}>自托管数据层 server 的地址；不确定就保持默认</div>
          </div>
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
            <button type="button" className={styles.skipLink} onClick={onSkip}>
              暂不登录，本地模式使用
            </button>
            {canRegister ? (
              <>
                <span className={styles.auxDivider} aria-hidden="true">·</span>
                <button type="button" className={styles.registerLink} onClick={() => setMode("register")}>
                  注册账号
                </button>
              </>
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
          未登录也可完整使用本地写作功能；随时可在 设置 → Server 登录
        </p>
      </div>
    </div>
  );
}
