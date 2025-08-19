# Art Que - Next.js Boilerplate

A modern Next.js boilerplate with Supabase and Tailwind CSS.

## 🚀 Features

- **Next.js 15** with App Router and TypeScript
- **Supabase** for backend services
- **Tailwind CSS** for styling
- **ESLint** for code quality
- Beautiful Hello World page with modern UI

## 🛠️ Setup

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Configure Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Copy your project URL and anon key
3. Update `.env.local` with your Supabase credentials:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 3. Run Development Server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to see your app.

## 📁 Project Structure

```
src/
├── app/
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
└── lib/
    └── supabase.ts
```

## 🎨 Technologies

- **Next.js** - React framework
- **TypeScript** - Type safety
- **Supabase** - Backend as a Service
- **Tailwind CSS** - Utility-first CSS framework
- **pnpm** - Fast package manager

## 📝 Next Steps

1. Configure your Supabase project
2. Set up authentication
3. Create your database schema
4. Build your application features

Happy coding! 🎉