import { api } from "./client.js";

export function login(password: string): Promise<unknown> {
  return api.post("/api/auth/login", { password });
}

export function logout(): Promise<unknown> {
  return api.post("/api/auth/logout");
}
