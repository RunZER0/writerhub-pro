# HomeworkPal - Assignment Management System

A professional, modern web application for managing freelance writers, assignments, and payments.

![HomeworkPal](https://img.shields.io/badge/HomeworkPal-blue?style=for-the-badge)

## Features

### 📊 Dashboard
- Real-time overview of writers, assignments, and payments
- Recent activity feed
- Top performing writers leaderboard

### 👥 Writers Management
- Add, edit, and remove writers
- Track contact information and pay rates
- Monitor individual writer balances

### 📝 Assignments
- Create and assign work to writers
- Auto-calculate payment based on word count × rate
- Track status: Pending, In Progress, Completed, Revision
- Deadline monitoring with overdue alerts

### 💰 Payments
- Track amounts owed to each writer
- Record payments with multiple methods
- Complete payment history log
- Export capabilities

### 📈 Reports
- Date-range filtering
- Writer performance metrics
- Export to CSV

## Tech Stack

- **HTML5** - Semantic markup
- **CSS3** - Modern styling with CSS variables
- **JavaScript** - Vanilla JS with localStorage persistence
- **Font Awesome** - Icons
- **Google Fonts** - Inter font family

## Getting Started

### Option 1: Direct Use
Simply open `index.html` in your web browser.

### Option 2: Local Server
```bash
# Using Python
python -m http.server 8000

# Using Node.js
npx serve
```

Then visit `http://localhost:8000`

## Deployment

This is a static website that can be deployed to:
- **Render** (Static Site)
- GitHub Pages
- Netlify
- Vercel

### Deploy to Render
1. Push to GitHub
2. Create a new Static Site on Render
3. Connect your GitHub repository
4. Set publish directory to `.` or `/`
5. Deploy!

## Data Storage

All data is stored in the browser's localStorage. Data persists between sessions but is specific to each browser/device.

## License

MIT License - Feel free to use and modify for your needs.

## Author

Built with ❤️ for efficient writer management
