create table users (
  id text primary key,
  github_id bigint not null unique,
  login text not null,
  name text,
  avatar_url text not null,
  created_at timestamptz not null default now()
);

create table sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  expires_at timestamptz not null
);
create index sessions_user_idx on sessions(user_id);

create table projects (
  id text primary key,
  owner_id text references users(id) on delete cascade,
  owner_guest_id text,
  title text not null,
  link_access text not null check (link_access in ('restricted', 'viewer', 'editor')),
  template text not null,
  is_demo_copy boolean not null default false,
  expires_at timestamptz,
  last_active_at timestamptz not null default now(),
  preview_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((owner_id is null) <> (owner_guest_id is null))
);
create index projects_owner_idx on projects(owner_id);
create index projects_guest_idx on projects(owner_guest_id);
create index projects_demo_idx on projects(last_active_at) where is_demo_copy;

create table project_members (
  project_id text not null references projects(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  last_opened_at timestamptz not null default now(),
  starred boolean not null default false,
  primary key (project_id, user_id)
);
create index project_members_user_idx on project_members(user_id);

create table project_docs (
  project_id text primary key references projects(id) on delete cascade,
  yjs_state bytea not null,
  stored_bytes int not null,
  updated_at timestamptz not null default now()
);
