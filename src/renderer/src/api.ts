import type { LauncherApi } from '../../shared/api'

export const api: LauncherApi = (window as unknown as { api: LauncherApi }).api
