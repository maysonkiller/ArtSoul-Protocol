import { React } from './react-runtime.js';
import { scheduleTimestamp } from '../features/collections/launch-config.js';

const monthLabel = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayLabel = new Intl.DateTimeFormat('en', { dateStyle: 'full', timeZone: 'UTC' });
const weekdays = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function inputText(timestamp, original) {
    return Number.isFinite(timestamp)
        ? new Date(timestamp).toISOString().replace(/:00\.000Z$|\.000Z$|Z$/, '').replace('T', ' ')
        : (original || '');
}

function monthStart(timestamp, offset = 0) {
    const date = new Date(timestamp);
    date.setUTCDate(1);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCMonth(date.getUTCMonth() + offset);
    return date;
}

export function CollectionScheduleField({ label, value, onChange }) {
    const [editing, setEditing] = React.useState(null);
    const [month, setMonth] = React.useState(null);
    const details = React.useRef(null);
    const id = React.useId();
    const timestamp = scheduleTimestamp(value);
    const display = inputText(timestamp, value);

    function edit(text) {
        setEditing(text);
        const datetime = text.trim().replace(' ', 'T');
        const parsed = scheduleTimestamp(/(?:Z|[+-]\d\d:\d\d)$/.test(datetime) ? datetime : datetime + 'Z');
        onChange(Number.isFinite(parsed) ? new Date(parsed).toISOString() : text);
    }
    function pick(date) {
        const day = date.toISOString().slice(0, 10);
        const time = Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(11) : '00:00:00.000Z';
        onChange(day + 'T' + time);
        details.current.open = false;
        details.current.querySelector('summary').focus();
    }
    const next = month && monthStart(month, 1);
    const days = month ? (next - month) / 86400000 : 0;
    const invalid = Boolean(value && !Number.isFinite(timestamp) && editing === null);
    return <div className="launch-field launch-schedule">
        <label htmlFor={id}>{label}</label>
        <input id={id} lang="en" type="text" placeholder="YYYY-MM-DD HH:mm" autoComplete="off" spellCheck={false}
            value={editing ?? display} onFocus={() => setEditing(display)} onBlur={() => setEditing(null)}
            onChange={event => edit(event.target.value)} aria-invalid={invalid} aria-describedby={invalid ? id + '-error' : undefined} />
        {invalid && <span id={id + '-error'}>Enter a valid UTC date and time in the format YYYY-MM-DD HH:mm.</span>}
        <details ref={details} onKeyDown={event => {
            if (event.key === 'Escape' && details.current.open) {
                details.current.open = false;
                details.current.querySelector('summary').focus();
                event.stopPropagation();
            }
        }} onToggle={event => setMonth(event.currentTarget.open ? monthStart(Number.isFinite(timestamp) ? timestamp : Date.now()) : null)}>
            <summary>Choose date</summary>
            {month && <div className="launch-calendar" role="group" aria-label={label + ' calendar'}>
                <div className="launch-calendar-heading">
                    <button type="button" aria-label="Previous month" disabled={month.getUTCFullYear() === 0 && month.getUTCMonth() === 0} onClick={() => setMonth(monthStart(month, -1))}>‹</button>
                    <strong aria-live="polite">{monthLabel.format(month)}</strong>
                    <button type="button" aria-label="Next month" disabled={next.getUTCFullYear() > 9999} onClick={() => setMonth(next)}>›</button>
                </div>
                <div className="launch-calendar-days">
                    {weekdays.map(day => <span key={day} aria-hidden="true">{day}</span>)}
                    {Array.from({ length: days }, (_, index) => {
                        const date = new Date(+month + index * 86400000);
                        return <button key={index} type="button" aria-label={dayLabel.format(date)}
                            aria-pressed={Number.isFinite(timestamp) && date.toISOString().slice(0, 10) === display.slice(0, 10)}
                            style={index === 0 ? { gridColumnStart: (date.getUTCDay() + 6) % 7 + 1 } : undefined}
                            onClick={() => pick(date)}>{index + 1}</button>;
                    })}
                </div>
            </div>}
        </details>
    </div>;
}
