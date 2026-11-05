-- 随记：笔记表。每个用户只能读写自己的笔记（行级安全）。
create table if not exists public.notes (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create index if not exists notes_user_updated on public.notes (user_id, updated_at desc);

alter table public.notes enable row level security;

drop policy if exists "own notes" on public.notes;
create policy "own notes" on public.notes
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 文件：内容存在私有存储桶 files 里，路径是 <user_id>/<id>；这张表记原始文件名和大小。
create table if not exists public.files (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  path text not null,
  size bigint not null default 0,
  mime text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists files_user_created on public.files (user_id, created_at desc);

-- folder：来自哪个同步文件夹（网页单独上传的为空）；name 是文件夹内的相对路径。
-- local_key：Mac 同步程序用来认出同一个本地文件。
alter table public.files add column if not exists folder text not null default '';
alter table public.files add column if not exists local_key text;
alter table public.files add column if not exists updated_at timestamptz not null default now();
create unique index if not exists files_user_local_key on public.files (user_id, local_key);
-- links / tags：Markdown 里的 [[双链]] 目标和 front matter 标签，给关系图谱用。
alter table public.files add column if not exists links text[] not null default '{}';
alter table public.files add column if not exists tags text[] not null default '{}';

alter table public.files enable row level security;

drop policy if exists "own files" on public.files;
create policy "own files" on public.files
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "own objects" on storage.objects;
create policy "own objects" on storage.objects
  for all to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);

-- 让其他设备实时收到改动
do $$
declare t text;
begin
  foreach t in array array['notes', 'files'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- 助手用的 API key：每人一行。key 由服务器端加密（AI_KEY_SECRET），表没有任何访问策略，
-- 所以只有服务器（service role）能读写，页面只能看到 key 的末四位。
create table if not exists public.ai_keys (
  user_id uuid primary key references auth.users (id) on delete cascade,
  base_url text not null,
  model text not null,
  key_enc text not null,
  key_hint text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.ai_keys enable row level security;
