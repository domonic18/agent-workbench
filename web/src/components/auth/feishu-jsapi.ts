// 飞书工作台免登 JSAPI:动态加载 h5sdk,requestAccess 取一次性 code(需客户端 V6.9.0+),
// 8s 静默回退 requestAuthCode,20s 超时兜底;失败消息带诊断串,免登静默失败时无需远程调试即可定位卡点。
const H5SDK_URL = "https://lf1-cdn-tos.bytegoofy.com/goofy/lark/op/h5-js-sdk-1.5.26.js";

interface AuthCodeResult {
  errno?: number;
  errCode?: number;
  errMsg?: string;
  code?: string;
}

type JsapiFn = (opts: Record<string, unknown>) => void;

interface H5SdkWindow {
  __JSSDK_VERSION__?: { SDKVersion?: string; SDKCDNVersion?: string };
  h5sdk?: {
    ready: (fn: () => void) => void;
    requestAccess?: JsapiFn;
    requestAuthCode?: JsapiFn;
  };
  tt?: {
    requestAccess?: JsapiFn;
    requestAuthCode?: JsapiFn;
  };
}

declare global {
  interface Window {
    tt?: H5SdkWindow["tt"];
    h5sdk?: H5SdkWindow["h5sdk"];
  }
}

let sdkLoadPromise: Promise<H5SdkWindow> | null = null;

function loadH5Sdk(): Promise<H5SdkWindow> {
  if (sdkLoadPromise !== null) {
    return sdkLoadPromise;
  }
  sdkLoadPromise = new Promise((resolve, reject) => {
    const existing = window as H5SdkWindow;
    if (existing.h5sdk !== undefined || existing.tt !== undefined) {
      resolve(existing);
      return;
    }
    const script = document.createElement("script");
    script.src = H5SDK_URL;
    script.onload = () => {
      resolve(window as H5SdkWindow);
    };
    script.onerror = () => {
      sdkLoadPromise = null;
      reject(new Error("飞书 JSSDK 加载失败,请重试或使用口令登录"));
    };
    document.head.appendChild(script);
  });
  return sdkLoadPromise;
}

/** 免登授权须在 h5sdk.ready 后调用;旧客户端原生层不识别 requestAccess 且静默丢弃,须回退 */
export async function requestFeishuAuthCode(appId: string): Promise<string> {
  const w = await loadH5Sdk();
  return new Promise((resolve, reject) => {
    let readyFired = false;
    let settled = false;
    let branch = "-";

    const diag = (): string => {
      const v = w.__JSSDK_VERSION__;
      return [
        `sdk=${v?.SDKVersion ?? "?"}/${v?.SDKCDNVersion ?? "?"}`,
        `h5sdk=${w.h5sdk !== undefined ? 1 : 0}`,
        `tt=${w.tt !== undefined ? 1 : 0}`,
        `access=${typeof (w.tt?.requestAccess ?? w.h5sdk?.requestAccess)}`,
        `authcode=${typeof (w.tt?.requestAuthCode ?? w.h5sdk?.requestAuthCode)}`,
        `ready=${readyFired ? 1 : 0}`,
        `branch=${branch}`,
        `appIdLen=${appId.length}`,
      ].join(" ");
    };

    const finish = (r: AuthCodeResult | undefined): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(mainTimer);
      if (r?.code !== undefined && r.code !== "") {
        resolve(r.code);
        return;
      }
      reject(
        new Error(
          `飞书授权失败(errno=${r?.errno ?? "?"} errCode=${r?.errCode ?? "?"} ${r?.errMsg ?? ""})[${diag()}]`,
        ),
      );
    };

    const fail = (message: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(mainTimer);
      reject(new Error(`${message} [${diag()}]`));
    };

    // 超时兜底:SDK 无响应(bridge 未就绪/客户端过旧/弹层被拦)时不无限挂起,回落口令登录
    const mainTimer = setTimeout(
      () => fail("飞书授权超时,请重试或使用口令登录"),
      20_000,
    );

    const guarded = (invoke: () => void, fnName: string): boolean => {
      try {
        invoke();
        return true;
      } catch (err) {
        fail(`飞书免登调用异常 ${fnName}: ${err instanceof Error ? err.message : String(err)}`);
        return true;
      }
    };

    const callAuthCode = (): boolean => {
      const fn = w.tt?.requestAuthCode ?? w.h5sdk?.requestAuthCode;
      if (typeof fn !== "function") {
        return false;
      }
      branch = "authcode";
      return guarded(() => fn({ appId, success: finish, fail: finish }), "requestAuthCode");
    };

    const callAccess = (): boolean => {
      const fn = w.tt?.requestAccess ?? w.h5sdk?.requestAccess;
      if (typeof fn !== "function") {
        return false;
      }
      branch = "access";
      return guarded(
        () => fn({ appID: appId, scopeList: [], state: "", success: finish, fail: finish }),
        "requestAccess",
      );
    };

    w.h5sdk?.ready(() => {
      readyFired = true;
      if (settled) {
        return;
      }
      if (callAccess()) {
        setTimeout(() => {
          if (!settled && branch === "access") {
            callAuthCode();
          }
        }, 8_000);
        return;
      }
      if (!callAuthCode()) {
        fail("当前环境不支持飞书免登,请使用口令登录");
      }
    });
  });
}
