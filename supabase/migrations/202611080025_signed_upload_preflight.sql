-- Signed uploads keep the student's owner_id while bypassing the application's request-body limit.
-- Storage signs an INSERT preflight with empty metadata on older versions, or the SDK's two-byte JSON body.
-- The private buckets still enforce actual MIME/size; registration verifies actual metadata, owner and state.
do $$
begin
  if to_regclass('storage.objects') is not null then
    execute $policy$
      create policy assignment_submissions_signed_upload_preflight on storage.objects for insert to authenticated
      with check (bucket_id = 'assignment-submissions' and private.assignment_file_uploadable(name)
        and (metadata is null or metadata = '{}'::jsonb
          or (metadata ->> 'mimetype' = 'application/json' and metadata ->> 'contentLength' = '2')))
    $policy$;
    execute $policy$
      create policy session_attachments_signed_upload_preflight on storage.objects for insert to authenticated
      with check (bucket_id = 'session-plan-attachments' and private.session_attachment_uploadable(name)
        and (metadata is null or metadata = '{}'::jsonb
          or (metadata ->> 'mimetype' = 'application/json' and metadata ->> 'contentLength' = '2')))
    $policy$;
  end if;
end;
$$;
