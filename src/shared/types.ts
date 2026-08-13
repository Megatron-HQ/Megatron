export interface Skill {
  id: number
  name: string
  source_type: string
  source_path: string
  plugin_name?: string
  description?: string
  last_scanned_at: string
}

export interface Invocation {
  id: number
  source_uuid: string
  session_id: string
  skill_name: string
  args_text?: string
  invoked_at: string
  trigger_type: string
}

export interface Plugin {
  name: string
  marketplace: string
  marketplace_repo?: string
  installed_version: string
  scope: string
  install_path: string
  last_scanned_at: string
}

export interface Session {
  session_id: string
  cwd: string
  git_branch?: string
  started_at: string
  message_count: number
  source_mtime_ms: number
}
