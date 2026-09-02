/**
 * OnboardingWizard
 *
 * 首启新手引导向导：欢迎 → 配置模型服务（ProviderSetupStep）→ 使用说明（GuideStep）。
 * 基于共享 Dialog 原语（lg）：顶部进度圆点 + footer 导航；配置步的主操作
 * （测试连接 / 保存并继续）由步骤组件自持（对齐设置面板自带 save-bar 的惯例）。
 * ESC / 关闭 / 跳过均回调 onDismiss——完成标记由宿主（NovelApp）统一写入。
 */
import { useEffect, useState } from "react";
import { BookOpen, Calendar, FileText, Library, MessageSquare } from "lucide-react";
import { Button } from "../shared/primitives/Button.js";
import { Dialog } from "../shared/primitives/Dialog.js";
import { Icon } from "../shared/primitives/Icon.js";
import type { ApplicationConfigurationClient } from "../settings/ApplicationConfigurationClient.js";
import { GuideStep } from "./GuideStep.js";
import { ProviderSetupStep } from "./ProviderSetupStep.js";
import styles from "./OnboardingWizard.module.css";

export type OnboardingStep = "welcome" | "provider" | "guide";

const STEPS: readonly OnboardingStep[] = ["welcome", "provider", "guide"];

const STEP_TITLES: Readonly<Record<OnboardingStep, string>> = {
  welcome: "欢迎使用 Novel Harness",
  provider: "配置模型服务",
  guide: "上手指南",
};

const STEP_DESCRIPTIONS: Readonly<Record<OnboardingStep, string>> = {
  welcome: "AI 长篇小说创作工作台——三步完成上手：认识工作台、配置模型服务、了解界面。",
  provider: "Agent 依赖模型服务驱动；密钥加密存储于本机，未配置时对话为回声模式。",
  guide: "项目、四大视图、右栏实体引用与个性化设置的速览。",
};

const FEATURES: readonly { icon: typeof MessageSquare; title: string; desc: string; library?: boolean }[] = [
  { icon: MessageSquare, title: "对话", desc: "与主创作 Agent 推进剧情" },
  { icon: FileText, title: "内容", desc: "大纲与正文管理" },
  { icon: Calendar, title: "日程", desc: "事件序列编排" },
  { icon: Library, title: "书库", desc: "导入参考书自动解析", library: true },
];

export interface OnboardingWizardProps {
  readonly open: boolean;
  readonly configuration?: ApplicationConfigurationClient;
  /** 书库视图（试验功能，NOVEL_LIBRARY=1 才开启）：关闭时不向用户介绍 */
  readonly libraryEnabled?: boolean;
  readonly onDismiss: () => void;
}

export function OnboardingWizard({ open, configuration, libraryEnabled, onDismiss }: OnboardingWizardProps) {
  const [step, setStep] = useState<OnboardingStep>("welcome");
  useEffect(() => {
    if (open) setStep("welcome");
  }, [open]);
  const stepIndex = STEPS.indexOf(step);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onDismiss();
      }}
      title={STEP_TITLES[step]}
      description={STEP_DESCRIPTIONS[step]}
      size="lg"
      footer={
        <div className={styles.footerNav}>
          <div>
            {step !== "welcome" ? (
              <Button variant="ghost" onClick={() => setStep(STEPS[stepIndex - 1]!)}>
                ← 上一步
              </Button>
            ) : null}
          </div>
          <div className={styles.footerActions}>
            {step === "welcome" ? (
              <Button variant="ghost" onClick={onDismiss}>
                跳过引导
              </Button>
            ) : null}
            {step === "provider" ? (
              <Button variant="ghost" onClick={onDismiss}>
                暂时跳过，稍后在设置中配置
              </Button>
            ) : null}
            {step === "welcome" ? (
              <Button variant="primary" onClick={() => setStep("provider")}>
                开始配置 →
              </Button>
            ) : null}
            {step === "guide" ? (
              <Button variant="primary" onClick={onDismiss}>
                开始创作
              </Button>
            ) : null}
          </div>
        </div>
      }
    >
      <div className={styles.progress} aria-hidden="true">
        {STEPS.map((item, index) => (
          <span key={item} className={styles.dot} data-active={index <= stepIndex} />
        ))}
        <span className={styles.progressLabel}>
          {stepIndex + 1} / {STEPS.length}
        </span>
      </div>
      {step === "welcome" ? <WelcomeStep libraryEnabled={libraryEnabled} /> : null}
      {step === "provider" ? (
        <ProviderSetupStep configuration={configuration} onDone={() => setStep("guide")} />
      ) : null}
      {step === "guide" ? <GuideStep libraryEnabled={libraryEnabled} /> : null}
    </Dialog>
  );
}

function WelcomeStep({ libraryEnabled }: { readonly libraryEnabled?: boolean }) {
  const features = FEATURES.filter((feature) => libraryEnabled === true || feature.library !== true);
  return (
    <div className={styles.welcome}>
      <span className={styles.kicker}>Getting Started</span>
      <h2>
        <Icon icon={BookOpen} size="sm" /> AI 长篇小说创作工作台
      </h2>
      <p>
        与主创作 Agent 对话推进剧情：起草场景、修订正文、推进大纲节点，产出经你审批后落库；
        大纲、正文、人物档案{libraryEnabled === true ? "与参考书库" : ""}都在同一个工作台里。
      </p>
      <ul className={styles.featureList}>
        {features.map((feature) => (
          <li key={feature.title}>
            <span className={styles.featureIcon} aria-hidden="true">
              <Icon icon={feature.icon} size="sm" />
            </span>
            <div>
              <strong>{feature.title}</strong>
              <span>{feature.desc}</span>
            </div>
          </li>
        ))}
      </ul>
      <p className={styles.welcomeNote}>
        下一步将配置模型服务（API 密钥加密存储于本机）；未配置时对话为回声模式，不会调用大模型。
      </p>
    </div>
  );
}
