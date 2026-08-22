import { useEffect } from 'react';

interface PageTitleProps {
  title: string;
}

export function PageTitle({ title }: PageTitleProps) {
  useEffect(() => {
    document.title = `${title} | AI Crop Disease Detection`;
  }, [title]);
  return null;
}
