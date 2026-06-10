ALTER TABLE review_jobs
  ADD COLUMN extraction_type TEXT;
-- Values: 'API' | 'URL' | 'Gemini' | null
-- 'API'    = zenodo/figshare resolved via domain API
-- 'URL'    = arxiv/vixra resolved via URL string transform
-- 'Gemini' = url_context fallback resolved the PDF URL
-- null     = no pdf_url on job, or PDF path failed entirely
