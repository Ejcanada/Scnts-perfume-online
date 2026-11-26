# SCNTS Perfume

Perfume website. FastAPI (api/index.py) + Supabase + Vercel.

Run on your computer:

    pip install -r requirements.txt
    copy .env.example to .env and fill in your keys
    uvicorn api.index:app --reload

Deploy: push to GitHub main, then add SUPABASE_URL, SUPABASE_SERVICE_KEY and JWT_SECRET in Vercel > Settings > Environment Variables.
