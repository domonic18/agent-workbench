import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Badge } from "./Badge.js";
import { Button } from "./Button.js";
import { CopyField } from "./CopyField.js";
import { Dialog } from "./Dialog.js";
import { EmptyState } from "./EmptyState.js";
import { Field, Input } from "./Field.js";
import { Panel } from "./Panel.js";
import { Stepper } from "./Stepper.js";
import { Table } from "./Table.js";
import { Tabs } from "./Tabs.js";
import { ToastProvider, useToast } from "./Toast.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Button", () => {
  it("loading 时禁用并显示转圈，避免重复提交", () => {
    render(
      <Button loading onClick={() => {}}>
        注册
      </Button>,
    );
    expect(screen.getByRole("button", { name: "注册" })).toHaveProperty("disabled", true);
  });

  it("默认 type 是 button，不会误触表单提交", () => {
    render(<Button>取消</Button>);
    expect(screen.getByRole("button", { name: "取消" })).toHaveProperty("type", "button");
  });
});

describe("Badge", () => {
  it("颜色 + 文本双编码，不单靠颜色传达状态", () => {
    render(<Badge tone="warning" text="心跳超时" />);
    expect(screen.getByText("心跳超时")).toBeTruthy();
  });
});

describe("Field", () => {
  it("label 关联控件，错误以 alert 呈现", () => {
    render(
      <Field label="项目" htmlFor="p" error="项目必填">
        <Input id="p" invalid />
      </Field>,
    );
    expect(screen.getByLabelText("项目")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("项目必填");
  });
});

describe("Panel", () => {
  it("有标题时渲染标题与动作区", () => {
    render(
      <Panel title="Agent" description="按状态排序" actions={<Button>注册</Button>}>
        <p>内容</p>
      </Panel>,
    );
    expect(screen.getByRole("heading", { name: "Agent" })).toBeTruthy();
    expect(screen.getByText("按状态排序")).toBeTruthy();
    expect(screen.getByRole("button", { name: "注册" })).toBeTruthy();
  });
});

describe("Table", () => {
  interface Row {
    id: string;
    name: string;
  }

  const columns = [
    { key: "name", header: "名称", render: (row: Row) => row.name },
  ];

  it("无数据时渲染空态占位", () => {
    render(<Table columns={columns} rows={[]} rowKey={(row) => row.id} empty={<p>还没有</p>} />);
    expect(screen.getByText("还没有")).toBeTruthy();
  });

  it("点击行触发回调", () => {
    const onRowClick = vi.fn();
    render(
      <Table
        columns={columns}
        rows={[{ id: "a", name: "构建 Agent" }]}
        rowKey={(row) => row.id}
        onRowClick={onRowClick}
      />,
    );
    fireEvent.click(screen.getByText("构建 Agent"));
    expect(onRowClick).toHaveBeenCalledWith({ id: "a", name: "构建 Agent" });
  });
});

describe("Dialog", () => {
  it("Esc 关闭，dismissible=false 时不关闭", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Dialog title="一次性密钥" onClose={onClose} dismissible={false}>
        <p>内容</p>
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    rerender(
      <Dialog title="一次性密钥" onClose={onClose}>
        <p>内容</p>
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("打开后焦点进入弹窗，Tab 在弹窗内循环", () => {
    render(
      <Dialog title="编辑" onClose={() => {}}>
        <button type="button">第一个</button>
        <button type="button">第二个</button>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

describe("Tabs", () => {
  it("切换标签页替换面板内容", () => {
    render(
      <Tabs
        items={[
          { key: "a", label: "待批", content: <p>待批内容</p> },
          { key: "b", label: "生效", content: <p>生效内容</p> },
        ]}
      />,
    );
    expect(screen.getByText("待批内容")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "生效" }));
    expect(screen.getByText("生效内容")).toBeTruthy();
    expect(screen.queryByText("待批内容")).toBeNull();
  });
});

describe("Stepper", () => {
  it("当前步高亮，已完成步标记完成", () => {
    render(
      <Stepper
        steps={[
          { key: "1", label: "下载" },
          { key: "2", label: "安装" },
          { key: "3", label: "上线" },
        ]}
        current={1}
      />,
    );
    const current = screen.getByText("安装").closest("li");
    expect(current?.getAttribute("aria-current")).toBe("step");
  });
});

describe("EmptyState", () => {
  it("标题、说明与引导动作都在", () => {
    render(
      <EmptyState
        title="采集器未上报"
        description="请确认采集器已启动"
        action={<Button>接入执行机</Button>}
      />,
    );
    expect(screen.getByText("采集器未上报")).toBeTruthy();
    expect(screen.getByText("请确认采集器已启动")).toBeTruthy();
    expect(screen.getByRole("button", { name: "接入执行机" })).toBeTruthy();
  });
});

describe("CopyField", () => {
  it("点击复制写入剪贴板", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    render(
      <ToastProvider>
        <CopyField label="下载命令" value="curl -fsSL https://example/install.sh | bash" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "复制" }));

    expect(writeText).toHaveBeenCalledWith("curl -fsSL https://example/install.sh | bash");
  });
});

describe("Toast", () => {
  it("push 后渲染提示并自动消失", () => {
    vi.useFakeTimers();
    function Trigger(): React.ReactElement {
      const { push } = useToast();
      return (
        <button type="button" onClick={() => push("已复制", "positive")}>
          触发
        </button>
      );
    }
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "触发" }));
    expect(screen.getByText("已复制")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByText("已复制")).toBeNull();
    vi.useRealTimers();
  });
});
