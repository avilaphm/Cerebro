alter table public.blog_posts
  add column if not exists research_angle_index smallint
    check (research_angle_index between 0 and 2);

comment on column public.blog_posts.research_angle_index is
  'Zero-based index of the source angle inside blog_research_runs.angles.';

update public.blog_posts as post
set research_angle_index = run.selected_angle_index::smallint
from public.blog_research_runs as run
where post.research_run_id = run.id
  and post.research_angle_index is null
  and run.selected_angle_index between 0 and 2;

create unique index if not exists blog_posts_research_angle_unique_idx
  on public.blog_posts (research_run_id, research_angle_index)
  where research_run_id is not null
    and research_angle_index is not null;

update public.blog_research_runs as run
set
  status = case
    when (
      select count(*)
      from public.blog_posts as post
      where post.research_run_id = run.id
        and post.research_angle_index is not null
    ) >= 3 then 'drafted'
    else 'ready'
  end,
  updated_at = now()
where run.status in ('generating', 'drafted')
  and exists (
    select 1
    from public.blog_posts as post
    where post.research_run_id = run.id
  );
