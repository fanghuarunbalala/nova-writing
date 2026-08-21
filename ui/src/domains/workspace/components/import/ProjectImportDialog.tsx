/**
 * ProjectImportDialog（欢迎页「从文件导入创建项目」）
 *
 * 流程：选择源文件（txt / zip，宿主白名单）→ 确定性解析预览（卷/章清单 + 字数）→
 * 行内微调（卷/章标题、章归属卷）→「选择位置并导入」（save 对话框 → 确定性落库 →
 * 派生 ProjectImporter 后台解构）→ 交回常规打开编排。正文与章卷结构 1:1 保留，
 * 导入即项目：不是书库参考资料，而是可继续写作的正典数据。
 */
import { useEffect, useState } from "react";
import { FileUp, FolderOpen, Sparkles } from "lucide-react";
import { withCallOptions } from "kkrpc";
import type { ImportJobProgress, ImportJobStage, ImportPreview, ImportStats } from "@novel/core";
import { Icon } from "../../../../shared/primitives/Icon.js";
import { Button } from "../../../../shared/primitives/Button.js";
import { Dialog } from "../../../../shared/primitives/Dialog.js";
import { Input } from "../../../../shared/primitives/Input.js";
import { Select } from "../../../../shared/primitives/Select.js";
import type { ToastKind } from "../../../../shared/state/ToastStore.js";
import type { NovelApiClient } from "@novel/core";
import styles from "./ProjectImportDialog.module.css";

/** 创建中阶段文案（后台进程执行；createProgress 轮询驱动） */
const STAGE_LABEL: Record<ImportJobStage, string> = {
  reading: "读取源文件…",
  parsing: "解析卷章结构…",
  "writing-files": "写入拆分文件…",
  "writing-db": "正文落库…（大书可能需要一两分钟，窗口保持可用）",
};

/** 创建进度轮询间隔（ms） */
const CREATE_POLL_MS = 600;

/**
 * 预览解析最坏 ~15s（20MiB 上限），按调用覆盖 kkrpc 默认 30s 请求超时（5 分钟余量；
 * 不动全局默认——其他调用保持快速失败语义）
 */
const PREVIEW_TIMEOUT_MS = 300_000;

export interface ProjectImportDialogProps {
  readonly open: boolean;
  readonly api: NovelApiClient;
  readonly onDismiss: () => void;
  readonly onNotify: (kind: ToastKind, text: string) => void;
  /** 导入成功（canceled=false）：交回常规打开编排 */
  readonly onImported: (reference: { referenceId: string; label: string }, stats: ImportStats, spawnSkipped?: string) => void;
}

/** 确认稿章（工作副本：标题与归属卷可编辑） */
type PlanChapter = ImportPreview["chapters"][number];
type PlanVolume = ImportPreview["volumes"][number];

export function ProjectImportDialog({ open, api, onDismiss, onNotify, onImported }: ProjectImportDialogProps) {
  const [sourcePath, setSourcePath] = useState<string | undefined>(undefined);
  const [previewing, setPreviewing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [plan, setPlan] = useState<ImportPreview | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [jobProgress, setJobProgress] = useState<ImportJobProgress | null>(null);

  const reset = () => {
    setSourcePath(undefined);
    setPlan(undefined);
    setError(undefined);
    setPreviewing(false);
    setCreating(false);
    setJobProgress(null);
  };

  // 创建为任务式：create RPC 启动即返回，终态（stats / error）经 createProgress 轮询取
  useEffect(() => {
    if (!creating) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const status = await api.projectImport.createProgress();
        if (cancelled) return;
        if (status === null) {
          setJobProgress(null);
          return;
        }
        if (status.phase === "running") {
          setJobProgress(status.progress);
          return;
        }
        if (status.phase === "succeeded" && status.result !== undefined) {
          const { reference, stats, spawnSkipped } = status.result;
          onImported(reference, stats, spawnSkipped);
          reset();
          return;
        }
        setCreating(false);
        setJobProgress(null);
        setError(status.error ?? "导入失败");
      } catch {
        // 轮询失败静默（下一轮重试）
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), CREATE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [creating, api]);

  const handlePick = async () => {
    setError(undefined);
    try {
      console.info("[import-dialog] pick RPC start");
      const picked = await api.projectImport.pickImportFile();
      console.info("[import-dialog] pick RPC resolved", JSON.stringify(picked));
      if (picked === null) return;
      setSourcePath(picked.sourcePath);
      setPreviewing(true);
      setPlan(undefined);
      try {
        const previewApi = withCallOptions(api.projectImport, { timeout: PREVIEW_TIMEOUT_MS });
        const preview = await previewApi.previewImport(picked.sourcePath);
        setPlan(preview);
        // 成功路径同样复位 previewing——busy = previewing || creating，泄漏会永久锁死弹窗
        setPreviewing(false);
      } catch (err) {
        setPreviewing(false);
        setSourcePath(undefined);
        onNotify("danger", `解析失败：${errText(err)}`);
      }
    } catch (err) {
      console.error("[import-dialog] pick RPC failed", err);
      onNotify("danger", `文件选择失败：${errText(err)}`);
    }
  };

  const patchVolume = (key: string, title: string) => {
    setPlan((prev) =>
      prev === undefined
        ? prev
        : { ...prev, volumes: prev.volumes.map((v) => (v.key === key ? { ...v, title } : v)) },
    );
  };

  const patchChapter = (key: string, patch: Partial<Pick<PlanChapter, "title" | "volumeKey">>) => {
    setPlan((prev) =>
      prev === undefined
        ? prev
        : { ...prev, chapters: prev.chapters.map((c) => (c.key === key ? { ...c, ...patch } : c)) },
    );
  };

  const handleCreate = async () => {
    if (sourcePath === undefined || plan === undefined) return;
    setCreating(true);
    setJobProgress(null);
    setError(undefined);
    try {
      // 任务式：RPC 即刻返回（落库在后台进程执行），终态经 createProgress 轮询
      console.info("[import-dialog] create RPC start");
      const result = await api.projectImport.createProjectFromImport({ sourcePath, plan });
      console.info("[import-dialog] create RPC resolved", JSON.stringify(result));
      if (result.canceled) {
        console.info("[import-dialog] target pick canceled → unlock");
        setCreating(false);
        onNotify("info", "已取消选择项目位置");
        return;
      }
      // creating 维持 true——轮询 effect 驱动至终态后交回 onImported
    } catch (err) {
      console.error("[import-dialog] create RPC failed", err);
      setCreating(false);
      setError(errText(err));
    }
  };

  const volumes: readonly PlanVolume[] = plan?.volumes ?? [];
  const chapters = plan?.chapters ?? [];
  const busy = previewing || creating;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next || busy) return;
        reset();
        onDismiss();
      }}
      title="从文件导入创建项目"
      description="导入已写好的书稿（txt / zip 内多个 txt 按文件名顺序合并为全书）：正文与卷章结构 1:1 保留，导入后由 AI 解构出大纲、人物与地点，可在项目中继续写作。"
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={() => { reset(); onDismiss(); }}>
            取消
          </Button>
          {plan === undefined ? (
            <Button variant="primary" loading={previewing} onClick={() => void handlePick()}>
              <Icon icon={FolderOpen} size="xs" />
              选择文件
            </Button>
          ) : (
            <Button variant="primary" loading={creating} onClick={() => void handleCreate()}>
              <Icon icon={FileUp} size="xs" />
              选择位置并导入
            </Button>
          )}
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <label>
          <span className={styles.note}>源文件（≤ 20 MiB · txt 或 zip · 编码自动探测 UTF-8 / GB18030 / Big5）</span>
          <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2px)" }}>
            <Input readOnly value={sourcePath ?? ""} placeholder="经「选择文件」选取（路径经宿主白名单授权）" />
            <Button variant="secondary" disabled={busy} onClick={() => void handlePick()}>
              <Icon icon={FolderOpen} size="xs" />
              {sourcePath === undefined ? "选择文件" : "重选"}
            </Button>
          </div>
        </label>

        {plan !== undefined ? (
          <>
            <div className={styles.metaRow}>
              <span>{plan.kind === "zip" ? "zip 合并" : "txt"}</span>
              <span>·</span>
              <span>{plan.totalChars.toLocaleString()} 字</span>
              <span>·</span>
              <span>{volumes.length > 0 ? `${volumes.length} 卷` : "未分卷"}</span>
              <span>·</span>
              <span>{chapters.length} 章</span>
            </div>

            {creating ? (
              <div className={styles.job} role="status">
                <span className={styles.jobText}>
                  {jobProgress !== null
                    ? `${STAGE_LABEL[jobProgress.stage]}${jobProgress.total > 0 ? `（${jobProgress.done}/${jobProgress.total}）` : ""}`
                    : "准备中…"}
                </span>
                <div className={styles.indicatorBar}>
                  <div
                    className={styles.indicatorFill}
                    style={{
                      width: `${
                        jobProgress !== null && jobProgress.total > 0
                          ? Math.max(Math.round((jobProgress.done / jobProgress.total) * 100), 4)
                          : 8
                      }%`,
                    }}
                  />
                </div>
                <span className={styles.jobSub}>正在后台导入，窗口保持可用——请勿在此期间关闭应用。</span>
              </div>
            ) : null}

            {volumes.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2px)" }}>
                {volumes.map((volume) => (
                  <div key={volume.key} className={styles.volumeRow}>
                    <span className={styles.volumeLabel}>卷名</span>
                    <Input
                      value={volume.title}
                      disabled={creating}
                      onChange={(e) => patchVolume(volume.key, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            ) : null}

            <div>
              <div className={styles.listHeader}>
                <span className={styles.listTitle}>章（标题可改 · 归属卷可调 · 落库后与原文逐字一致）</span>
              </div>
              <div className={styles.chapterScroll}>
                {chapters.map((chapter, index) => (
                  <div key={chapter.key} className={styles.chapterRow}>
                    <span className={styles.chapterNo}>{index + 1}</span>
                    <Input
                      value={chapter.title}
                      disabled={creating}
                      onChange={(e) => patchChapter(chapter.key, { title: e.target.value })}
                    />
                    <span className={styles.chapterChars}>{chapter.chars.toLocaleString()} 字</span>
                    <Select
                      disabled={creating}
                      value={chapter.volumeKey ?? ""}
                      onChange={(e) =>
                        patchChapter(chapter.key, { volumeKey: e.target.value === "" ? null : e.target.value })
                      }
                    >
                      <option value="">未分卷</option>
                      {volumes.map((volume) => (
                        <option key={volume.key} value={volume.key}>
                          {volume.title.trim() === "" ? volume.key : volume.title}
                        </option>
                      ))}
                    </Select>
                  </div>
                ))}
              </div>
            </div>

            {plan.skippedFiles.length > 0 ? (
              <div>
                <p className={styles.note}>zip 内以下非 txt 文件已忽略：</p>
                <ul className={styles.skipped}>
                  {plan.skippedFiles.map((file) => (
                    <li key={file}>{file}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p className={styles.note}>
              <Icon icon={Sparkles} size="xs" /> 导入完成后自动开始 AI 解构（大纲 / 人物 / 地点渐进生成，进度见工作台右下角）；解构不改动正文与章卷结构。
            </p>
          </>
        ) : null}

        {error !== undefined ? (
          <p className={styles.note} style={{ color: "var(--color-danger)" }} role="status">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
