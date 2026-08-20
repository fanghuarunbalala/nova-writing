/**
 * GuideStep
 *
 * 引导向导第 3 步：静态图文使用说明——打开项目 / 四大视图 /
 * 右栏与实体引用 / 模型与个性化（完成动作由向导 footer 的「开始创作」承担）。
 */
import {
  BookOpen,
  Calendar,
  FileText,
  FolderOpen,
  Library,
  MessageSquare,
  PanelRight,
  Settings,
} from "lucide-react";
import { Icon } from "../shared/primitives/Icon.js";
import styles from "./OnboardingWizard.module.css";

const VIEWS: readonly { icon: typeof MessageSquare; title: string; desc: string; library?: boolean }[] = [
  {
    icon: MessageSquare,
    title: "对话",
    desc: "与主创作 Agent 对话推进剧情——起草场景、修订正文、推进大纲节点，产出经审批后落库。",
  },
  { icon: FileText, title: "内容", desc: "大纲与正文管理，人物 / 地点档案在此维护。" },
  { icon: Calendar, title: "日程", desc: "事件序列编排与创作待办。" },
  { icon: Library, title: "书库", desc: "导入参考书，自动解析大纲 / 人物 / 地点 / 风格。", library: true },
];

export interface GuideStepProps {
  /** 书库视图（试验功能，NOVEL_LIBRARY=1 才开启）：关闭时不向用户介绍 */
  readonly libraryEnabled?: boolean;
}

export function GuideStep({ libraryEnabled }: GuideStepProps) {
  const views = VIEWS.filter((view) => libraryEnabled === true || view.library !== true);
  return (
    <div className={styles.stepBody}>
      <section className={styles.guideSection}>
        <h4>
          <Icon icon={FolderOpen} size="sm" /> 打开项目
        </h4>
        <p>
          在项目选择页选择或新建一个小说项目文件夹；大纲、正文、档案与对话记录都保存在本地。
        </p>
      </section>
      <section className={styles.guideSection}>
        <h4>
          <Icon icon={BookOpen} size="sm" /> {views.length === 4 ? "四大" : "三大"}视图
        </h4>
        <ul className={styles.viewList}>
          {views.map((view) => (
            <li key={view.title}>
              <span className={styles.viewIcon} aria-hidden="true">
                <Icon icon={view.icon} size="sm" />
              </span>
              <div>
                <strong>{view.title}</strong>
                <span>{view.desc}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className={styles.guideSection}>
        <h4>
          <Icon icon={PanelRight} size="sm" /> 右栏与实体引用
        </h4>
        <p>
          对话视图右栏是内容目录：点击条目可下钻章节、大纲单元、人物、地点的详情页；
          人物等实体还能直接拖入输入框，作为消息中的引用交给 Agent。
        </p>
      </section>
      <section className={styles.guideSection}>
        <h4>
          <Icon icon={Settings} size="sm" /> 模型与个性化
        </h4>
        <p>
          顶栏齿轮打开设置：可添加多个模型服务、为 Agent 绑定 Fast
          档、调整采样参数；外观页提供四套主题。模型修改对新对话生效。
        </p>
      </section>
    </div>
  );
}
