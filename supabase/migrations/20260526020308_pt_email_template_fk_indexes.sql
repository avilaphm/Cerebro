create index if not exists pt_email_templates_updated_by_idx
  on public.pt_email_templates (updated_by);

create index if not exists pt_email_templates_published_by_idx
  on public.pt_email_templates (published_by);
