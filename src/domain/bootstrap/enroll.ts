import { randomBytes } from "node:crypto";
import { MACHINE_HEARTBEAT } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import {
  findReusableMachine,
  updateMachineCollectorVersion,
} from "../../store/repositories/machine.js";
import { createIdentityService, type IdentityService } from "../identity/service.js";

export interface EnrollMachineInput {
  hostname: string;
  os: string;
  collectorVersion: string;
}

export interface EnrollMachineResult {
  machineId: string;
  /** 明文密钥,只在本次响应出现一次 */
  secret: string;
  /** 复用了存量机器行(同一台机重装或密钥丢失后重新 enroll) */
  reused: boolean;
}

/** 服务端生成机器 id:enroll 不接受客户端自报 id,避免冒名已登记机器 */
function newMachineId(): string {
  return `m-${randomBytes(6).toString("hex")}`;
}

/**
 * 执行机兑换机器身份(01 §2 / 04 §首次加入):
 * 同主机名同系统且已无存活上报的存量机器行直接复用并轮换密钥,
 * 保住该行上的 Agent 绑定,也不让同一台机在库里堆出多行;
 * 没有可复用行时新建机器。
 */
export async function enrollMachine(
  deps: { db: Db; now: () => number; service?: IdentityService },
  input: EnrollMachineInput,
): Promise<EnrollMachineResult> {
  const service = deps.service ?? createIdentityService({ db: deps.db, now: deps.now });
  const reusable = await findReusableMachine(deps.db, {
    hostname: input.hostname,
    os: input.os,
    staleBefore: deps.now() - MACHINE_HEARTBEAT.timeoutMs,
  });
  if (reusable !== undefined) {
    const rotated = await service.rotateMachineSecret(reusable.id);
    await updateMachineCollectorVersion(deps.db, reusable.id, input.collectorVersion);
    return { machineId: rotated.machine.id, secret: rotated.secret, reused: true };
  }
  const registered = await service.registerMachine({
    id: newMachineId(),
    hostname: input.hostname,
    os: input.os,
    collectorVersion: input.collectorVersion,
  });
  return { machineId: registered.machine.id, secret: registered.secret, reused: false };
}
