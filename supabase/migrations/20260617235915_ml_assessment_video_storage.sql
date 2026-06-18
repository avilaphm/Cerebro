update storage.buckets
set
  file_size_limit = 524288000,
  allowed_mime_types = array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
    'video/webm',
    'video/mp4',
    'video/quicktime',
    'video/x-m4v'
  ]
where id = 'pt-client-docs';
