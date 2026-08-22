import { Icon } from './Icon';

interface NoticeProps {
  title: string;
  message: string;
  tone?: 'danger' | 'info' | 'warning';
}

export function Notice({ title, message, tone = 'info' }: NoticeProps) {
  const icon = tone === 'danger' || tone === 'warning' ? 'warning' : 'info';
  return (
    <div className={`notice notice--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon name={icon} size={22} />
      <div>
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
    </div>
  );
}
