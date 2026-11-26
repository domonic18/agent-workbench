import { type FormEvent, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../../../api/client.js";
import { completeSetup, type BootstrapStatus } from "../../../api/bootstrap.js";
import { fetchAgents } from "../../../api/identity.js";
import { Button } from "../../ui/Button.js";
import { Field, Select } from "../../ui/Field.js";
import { Feedback } from "../Feedback.js";

export function StepBugfix({
  status,
  onComplete,
}: {
  status: BootstrapStatus;
  onComplete: () => void;
}) {
  const [primaryAgentId, setPrimaryAgentId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agents = useQuery({
    queryKey: ["identity", "agents"],
    queryFn: fetchAgents,
    retry: false,
  });

  const definition = status.definition;
  const activeAgents = (agents.data ?? []).filter((agent) => agent.status === "active");

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (primaryAgentId === "") {
      setError("请选择主责 Agent");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await completeSetup(primaryAgentId);
      onComplete();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "装配失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="w-full bg-surface border border-border rounded-lg p-6 shadow-sm max-md:[&_input]:min-h-touch max-md:[&_select]:min-h-touch max-md:[&_button]:min-h-touch">
      <h1 className="m-0 mb-1 text-xl font-semibold">启用 Bug 工作流</h1>
      <div className="mt-4 border border-border rounded-md p-4">
        <div><strong>预期结果</strong></div>
        <p className="text-muted text-xs mt-2">{definition.mandate.expectedResult}</p>
        <div><strong>范围</strong></div>
        <p className="text-muted text-xs mt-2">{definition.mandate.scope}</p>
        <div><strong>验收证据</strong></div>
        <ul className="mt-2 pl-5 text-sm text-muted">
          {definition.evidence.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <form className="flex flex-col items-stretch gap-4" onSubmit={(event) => void submit(event)}>
        <Field label="主责 Agent" htmlFor="primary">
          <Select
            id="primary"
            value={primaryAgentId}
            onChange={(event) => setPrimaryAgentId(event.target.value)}
          >
            <option value="">— 选择 —</option>
            {activeAgents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.displayName} ({agent.project})
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={pending}>
          {pending ? "装配中…" : "确认并开始使用"}
        </Button>
        <Feedback error={error} />
      </form>
    </div>
  );
}
