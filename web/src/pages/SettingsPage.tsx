import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SYSTEM_CONFIG_KEYS } from "@shared/constants.js";
import { getSettings, updateSettings, type SettingsUpdateBody } from "../api/settings.js";
import { ApiError } from "../api/client.js";
import { AsyncSection } from "../components/ui/AsyncSection.js";
import { Badge } from "../components/ui/Badge.js";
import { Button } from "../components/ui/Button.js";
import { Field, Input } from "../components/ui/Field.js";
import { Panel } from "../components/ui/Panel.js";
import { useToast } from "../components/ui/Toast.js";
import styles from "./SettingsPage.module.css";

interface FormState {
  publicUrl: string;
  consoleAllowedHosts: string;
  taskZombieHours: string;
  assignmentStallHours: string;
  feishuAppId: string;
  feishuAppSecret: string;
  feishuAllowedOpenIds: string;
  feishuApprovalChatId: string;
  feishuCollabChatId: string;
  embeddingBaseUrl: string;
  embeddingApiKey: string;
  embeddingModel: string;
  githubWebhookSecret: string;
}

const EMPTY_FORM: FormState = {
  publicUrl: "",
  consoleAllowedHosts: "",
  taskZombieHours: "",
  assignmentStallHours: "",
  feishuAppId: "",
  feishuAppSecret: "",
  feishuAllowedOpenIds: "",
  feishuApprovalChatId: "",
  feishuCollabChatId: "",
  embeddingBaseUrl: "",
  embeddingApiKey: "",
  embeddingModel: "",
  githubWebhookSecret: "",
};

const DB_KEY = SYSTEM_CONFIG_KEYS;

function valueFrom(map: Record<string, string | boolean>, key: string): string {
  const raw = map[key];
  if (raw === true) return "";
  return typeof raw === "string" ? raw : "";
}

function changedEntries(state: FormState, original: Record<string, string | boolean>): SettingsUpdateBody {
  const body: SettingsUpdateBody = {};
  const add = (key: keyof FormState, value: string, transform?: (v: string) => string | number) => {
    const current = valueFrom(original, DB_KEY[key]);
    if (value === "") {
      // 数值字段空串按「不修改」处理;清空阈值走专门逻辑,避免 Number("")=0 污染
      if (current === "" || transform !== undefined) {
        return;
      }
    }
    const next = transform === undefined ? value : transform(value);
    if (String(next) !== current) {
      (body as Record<string, string | number>)[key] = next;
    }
  };

  add("publicUrl", state.publicUrl.trim());
  add("consoleAllowedHosts", state.consoleAllowedHosts.trim());
  add("taskZombieHours", state.taskZombieHours.trim(), (v) => Number(v));
  add("assignmentStallHours", state.assignmentStallHours.trim(), (v) => Number(v));
  add("feishuAppId", state.feishuAppId.trim());
  add("feishuAppSecret", state.feishuAppSecret.trim());
  add("feishuAllowedOpenIds", state.feishuAllowedOpenIds.trim());
  add("feishuApprovalChatId", state.feishuApprovalChatId.trim());
  add("feishuCollabChatId", state.feishuCollabChatId.trim());
  add("embeddingBaseUrl", state.embeddingBaseUrl.trim());
  add("embeddingApiKey", state.embeddingApiKey.trim());
  add("embeddingModel", state.embeddingModel.trim());
  add("githubWebhookSecret", state.githubWebhookSecret.trim());

  return body;
}

export function SettingsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
    retry: (count, caught) => !(caught instanceof ApiError && caught.status === 401) && count < 2,
  });

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [restartPending, setRestartPending] = useState(false);

  const original = query.data?.values ?? {};

  const initialized = useRef(false);
  useEffect(() => {
    if (query.data === undefined || initialized.current) return;
    initialized.current = true;
    setForm({
      publicUrl: valueFrom(original, DB_KEY.publicUrl),
      consoleAllowedHosts: valueFrom(original, DB_KEY.consoleAllowedHosts),
      taskZombieHours: valueFrom(original, DB_KEY.taskZombieHours),
      assignmentStallHours: valueFrom(original, DB_KEY.assignmentStallHours),
      feishuAppId: valueFrom(original, DB_KEY.feishuAppId),
      feishuAppSecret: "",
      feishuAllowedOpenIds: valueFrom(original, DB_KEY.feishuAllowedOpenIds),
      feishuApprovalChatId: valueFrom(original, DB_KEY.feishuApprovalChatId),
      feishuCollabChatId: valueFrom(original, DB_KEY.feishuCollabChatId),
      embeddingBaseUrl: valueFrom(original, DB_KEY.embeddingBaseUrl),
      embeddingApiKey: "",
      embeddingModel: valueFrom(original, DB_KEY.embeddingModel),
      githubWebhookSecret: "",
    });
  }, [query.data, original]);

  const changedKeys = useMemo(() => Object.keys(changedEntries(form, original)), [form, original]);

  const update = useMutation({
    mutationFn: updateSettings,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      if (result.restartRequired || restartPending) {
        toast.push("已保存,重启后生效", "positive");
      } else {
        toast.push("保存成功", "positive");
      }
      setRestartPending((current) => current || result.restartRequired);
    },
    onError: (error) => {
      toast.push(error instanceof ApiError ? error.message : "保存失败", "danger");
    },
  });

  const updateField = (key: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    update.mutate(changedEntries(form, original));
  };

  const field = (
    key: keyof FormState,
    label: string,
    options: { hint?: string; type?: string; restart?: boolean } = {},
  ) => {
    const configured = original[DB_KEY[key]] === true;
    return (
      <Field
        key={key}
        label={
          <span className={styles.fieldLabel}>
            {label}
            {options.restart === true ? (
              <Badge tone="warning" text="重启生效" />
            ) : null}
          </span>
        }
        htmlFor={`settings-${key}`}
        hint={options.hint}
      >
        <Input
          id={`settings-${key}`}
          type={options.type ?? "text"}
          value={form[key]}
          placeholder={configured ? "已设置,留空保持不变" : undefined}
          onChange={(e) => updateField(key, e.target.value)}
        />
      </Field>
    );
  };

  return (
    <form className={styles.page} onSubmit={handleSubmit}>
      <AsyncSection
        pending={query.isPending}
        error={
          query.isError
            ? query.error instanceof ApiError
              ? query.error.message
              : "设置加载失败"
            : null
        }
        onRetry={() => void query.refetch()}
        hasMore={false}
        fetchingMore={false}
        onLoadMore={() => undefined}
      >
        <Panel title="基本">
          <div className={styles.section}>
            {field("publicUrl", "对外地址")}
          </div>
        </Panel>

        <Panel title="飞书">
          <div className={styles.section}>
            {field("feishuAppId", "App ID", { restart: true })}
            {field("feishuAppSecret", "App Secret", { type: "password", restart: true })}
            {field("feishuApprovalChatId", "审批卡片群 ID", { restart: true })}
            {field("feishuCollabChatId", "协作通知群 ID", { restart: true })}
            {field("feishuAllowedOpenIds", "白名单 open_id")}
          </div>
        </Panel>

        <Panel title="接入安全">
          <div className={styles.section}>
            {field("consoleAllowedHosts", "允许的来源 Host")}
          </div>
        </Panel>

        <Panel title="治理">
          <div className={styles.section}>
            {field("taskZombieHours", "僵尸任务判定小时数")}
            {field("assignmentStallHours", "派工停滞升级小时数")}
          </div>
        </Panel>

        <Panel title="知识嵌入">
          <div className={styles.section}>
            {field("embeddingBaseUrl", "Base URL", { restart: true })}
            {field("embeddingApiKey", "API Key", { type: "password", restart: true })}
            {field("embeddingModel", "模型", { restart: true })}
          </div>
        </Panel>

        <Panel title="GitHub Webhook">
          <div className={styles.section}>
            {field("githubWebhookSecret", "Webhook Secret", {
              type: "password",
              restart: true,
            })}
          </div>
        </Panel>
      </AsyncSection>

      <div className={styles.actionsBar}>
        <Button
          type="submit"
          variant="primary"
          icon={<Save size={15} aria-hidden="true" />}
          loading={update.isPending}
          disabled={changedKeys.length === 0}
        >
          保存
        </Button>
        {restartPending ? (
          <span className={styles.restartNotice}>部分配置已变更,请重启控制台后生效</span>
        ) : null}
      </div>
    </form>
  );
}
