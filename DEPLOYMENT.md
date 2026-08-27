# Chatzab Production 1.0

1. Keep the GitHub repository private.
2. Push this project to the Chatzab GitHub repository.
3. Create a production PostgreSQL database.
4. Deploy the repository as a Node web service.
5. Set DATABASE_URL and CHATZAB_ORIGINS in the hosting dashboard.
6. Confirm /health returns ok:true.
7. Add the custom domain and HTTPS.
8. Move media from local filesystem to persistent object storage before a serious public launch.

Important: local media storage is not reliable on hosts with ephemeral disks. Use object storage and private/signed media URLs for production.
Never commit .env or secrets.
