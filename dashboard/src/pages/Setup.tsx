import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { api } from '@/lib/api';
import { copyText, toast } from '@/components/Toast';
import ModelList from '@/components/ModelList';

interface Key { id: number; name: string; masked: string; enabled: boolean; }

const TOOLS = [
  { id: 'claude-code', label: 'Claude Code', badge: 'CC' },
  { id: 'openai-api', label: 'OpenAI API', badge: 'AI' },
  { id: 'env-vars', label: 'Env Variables', badge: '$_' },
  { id: 'api-ref', label: 'API Reference', badge: '{}' },
] as const;

export default function Setup() {
  const [keys, setKeys] = useState<Key[]>([]);
  const [userKey, setUserKey] = useState('YOUR_API_KEY');
  const [tab, setTab] = useState<string>('claude-code');

  useEffect(() => {
    (async () => {
      const [r, me] = await Promise.all([
        api<{ keys: Key[] }>('/keys'),
        api<{ firstKey?: string }>('/me'),
      ]);
      if (r?.keys) setKeys(r.keys.filter(k => k.enabled));
      if (me?.firstKey) setUserKey(me.firstKey);
    })();
  }, []);

  return (
    <div style={{ animation: 'pageIn 0.45s cubic-bezier(0.2,0.8,0.2,1)' }}>
      <div className="text-[10px] font-semibold uppercase mb-3" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.14em', color: 'var(--color-accent)' }}>
        WORKSPACE / SETUP
      </div>

      <div className="flex justify-between items-start mb-2 max-md:flex-col max-md:gap-3">
        <div>
          <h1 className="font-bold mb-1" style={{ fontSize: 'clamp(28px, 5vw, 38px)', letterSpacing: '-.035em', lineHeight: 1.1 }}>
            Setup
          </h1>
          <p className="text-muted text-[13px]">Your tools. One API. The same wallet.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-semibold shrink-0" style={{ background: 'var(--color-green-bg)', color: '#4ade80' }}>
          <span className="w-[6px] h-[6px] rounded-full" style={{ background: '#4ade80', animation: 'statusPulse 2s ease-in-out infinite' }} />
          Operational
        </span>
      </div>
      <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', marginBottom: 32 }} />

      <div className="flex items-center gap-2.5 px-4 py-2.5 mb-5 rounded-xl" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-muted)" strokeWidth="2" className="shrink-0"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" /></svg>
        <select
          className="w-auto min-w-[260px] text-[11px] py-2 px-3"
          style={{ fontFamily: 'var(--font-mono)', background: 'var(--color-bg)', border: '1px solid var(--color-border2)' }}
        >
          {keys.length === 0
            ? <option>No keys yet -- create one first</option>
            : keys.map(k => <option key={k.id} value={k.masked}>{k.name} -- {k.masked}</option>)
          }
        </select>
        <button onClick={() => userKey !== 'YOUR_API_KEY' ? copyText(userKey) : toast('Create an API key first')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-all duration-150 hover:border-accent" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border2)', color: 'var(--color-text2)' }}>
          <Copy size={12} /> Copy
        </button>
        <a className="ml-auto text-[11px] font-medium cursor-pointer whitespace-nowrap" style={{ color: 'var(--color-accent)' }}>Manage keys &rarr;</a>
      </div>

      <div className="flex min-h-[480px] max-md:flex-col">
        <div className="w-[200px] shrink-0 flex flex-col max-md:w-full max-md:rounded-t-xl max-md:rounded-b-none" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRight: 'none', borderRadius: '14px 0 0 14px' }}>
          <div className="flex-1 p-2">
            {TOOLS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="flex items-center gap-2 w-full px-3 py-2 my-0.5 text-[12px] font-medium rounded-lg border-none transition-all duration-150"
                style={tab === t.id ? { color: 'var(--color-accent)', background: 'var(--color-accent-surface)' } : { color: 'var(--color-muted)', background: 'none' }}
              >
                <span
                  className="w-6 h-6 rounded-md flex items-center justify-center text-[9px] font-bold shrink-0"
                  style={tab === t.id
                    ? { background: 'var(--color-accent)', color: '#031217' }
                    : { background: 'var(--color-accent-surface)', color: 'var(--color-accent)' }
                  }
                >
                  {t.badge}
                </span>
                {t.label}
              </button>
            ))}
          </div>
          <div className="p-3 mt-auto" style={{ borderTop: '1px solid var(--color-border)' }}>
            <div className="text-[9px] font-semibold text-muted uppercase mb-1.5" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.14em' }}>Gateway</div>
            <div onClick={() => copyText('https://gw.edgey.shop/v1')} className="flex items-center justify-between gap-1.5 px-2.5 py-2 rounded-lg cursor-pointer text-[10px] break-all transition-all duration-150 hover:border-accent" style={{ fontFamily: 'var(--font-mono)', background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-accent)' }}>
              gw.edgey.shop/v1
              <Copy size={11} className="shrink-0 opacity-50" />
            </div>
          </div>
        </div>

        <div className="flex-1 min-w-0 overflow-y-auto p-6 max-md:rounded-t-none max-md:rounded-b-xl" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: '0 14px 14px 0' }}>
          {tab === 'claude-code' && <ClaudeCodeSetup userKey={userKey} />}
          {tab === 'openai-api' && <OpenAISetup userKey={userKey} />}
          {tab === 'env-vars' && <EnvVarsSetup userKey={userKey} />}
          {tab === 'api-ref' && <ApiRefSetup />}
        </div>
      </div>
    </div>
  );
}

function ToolHeader({ badge, name, desc, gradient }: { badge: string; name: string; desc: string; gradient: string }) {
  return (
    <div className="flex items-center gap-3 mb-6 pb-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
      <div className="w-9 h-9 rounded-lg flex items-center justify-center text-[11px] font-bold shrink-0" style={{ background: gradient, color: '#031217' }}>{badge}</div>
      <div>
        <div className="text-[14px] font-bold tracking-tight mb-0.5">{name}</div>
        <div className="text-[11.5px] text-muted">{desc}</div>
      </div>
    </div>
  );
}

function CodeBlock({ title, code, onCopy }: { title: string; code: string; onCopy?: () => void }) {
  return (
    <div className="rounded-xl mb-3.5 overflow-hidden" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
      <div className="flex justify-between items-center px-3.5 py-2 text-[10px] font-semibold text-muted" style={{ background: 'var(--color-card2)', borderBottom: '1px solid var(--color-border)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em' }}>
        <span>{title}</span>
        <button onClick={onCopy || (() => copyText(code))} className="px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all duration-150 border-none" style={{ background: 'var(--color-accent-surface)', color: 'var(--color-accent)' }}>Copy</button>
      </div>
      <pre className="p-3.5 text-[11.5px] leading-[1.7] whitespace-pre-wrap break-all text-text2 overflow-x-auto" style={{ fontFamily: 'var(--font-mono)' }} dangerouslySetInnerHTML={{ __html: code }} />
    </div>
  );
}

function Step({ num, children }: { num: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 mb-6 last:mb-0 max-md:flex-col max-md:gap-2">
      <div className="text-[24px] font-extrabold tracking-tight shrink-0 w-8 pt-0.5 tabular-nums" style={{ color: 'var(--color-accent)', opacity: 0.3 }}>{num}</div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function OsTabs({ tabs, children }: { tabs: { id: string; label: string }[]; children: (active: string) => React.ReactNode }) {
  const [active, setActive] = useState(tabs[0].id);
  return (
    <>
      <div className="flex gap-0.5 mb-3 w-fit rounded-lg p-[3px]" style={{ background: 'var(--color-bg)' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActive(t.id)} className="px-3 py-[5px] rounded-md text-[11px] font-semibold border-none transition-all duration-150" style={active === t.id ? { background: 'var(--color-card3)', color: 'var(--color-text)' } : { background: 'none', color: 'var(--color-muted)' }}>{t.label}</button>
        ))}
      </div>
      {children(active)}
    </>
  );
}

function hl(s: string) { return `<span style="color:var(--color-accent)">${s}</span>`; }

function ClaudeCodeSetup({ userKey }: { userKey: string }) {
  return (
    <>
      <ToolHeader badge="CC" name="Claude Code" desc="Anthropic's agentic coding tool -- point it at edgey." gradient="var(--color-accent)" />
      <Step num="01">
        <h4 className="text-[13px] font-semibold mb-3">Set your environment</h4>
        <OsTabs tabs={[{ id: 'win', label: 'Windows' }, { id: 'unix', label: 'macOS / Linux' }]}>
          {active => active === 'win'
            ? <CodeBlock title="PowerShell" code={`${hl('$env:')}ANTHROPIC_BASE_URL = ${hl('"https://gw.edgey.shop/v1"')}\n${hl('$env:')}ANTHROPIC_API_KEY = ${hl(`"${userKey}"`)}`} />
            : <CodeBlock title="Bash / Zsh" code={`${hl('export')} ANTHROPIC_BASE_URL=${hl('"https://gw.edgey.shop/v1"')}\n${hl('export')} ANTHROPIC_API_KEY=${hl(`"${userKey}"`)}`} />
          }
        </OsTabs>
      </Step>
      <Step num="02">
        <h4 className="text-[13px] font-semibold mb-3">Launch Claude Code</h4>
        <CodeBlock title="Terminal" code="claude" />
      </Step>
    </>
  );
}

function OpenAISetup({ userKey }: { userKey: string }) {
  return (
    <>
      <ToolHeader badge="AI" name="OpenAI-compatible API" desc="Use the OpenAI SDK or any compatible client." gradient="linear-gradient(135deg, #059669, #34d399)" />
      <Step num="01">
        <h4 className="text-[13px] font-semibold mb-3">Python (OpenAI SDK)</h4>
        <CodeBlock title="Python" code={`${hl('from')} openai ${hl('import')} OpenAI\n\nclient = OpenAI(\n    base_url=${hl('"https://gw.edgey.shop/v1"')},\n    api_key=${hl(`"${userKey}"`)},\n)\n\nresponse = client.chat.completions.create(\n    model=${hl('"claude-sonnet-5"')},\n    messages=[{${hl('"role"')}: ${hl('"user"')}, ${hl('"content"')}: ${hl('"Hello!"')}}],\n)\nprint(response.choices[0].message.content)`} />
      </Step>
      <Step num="02">
        <h4 className="text-[13px] font-semibold mb-3">cURL</h4>
        <CodeBlock title="Terminal" code={`curl https://gw.edgey.shop/v1/chat/completions \\\n  -H ${hl(`"Authorization: Bearer ${userKey}"`)} \\\n  -H ${hl('"Content-Type: application/json"')} \\\n  -d ${hl(`'{\n    "model": "claude-sonnet-5",\n    "messages": [{"role": "user", "content": "Hello!"}]\n  }'`)}`} />
      </Step>
      <Step num="03">
        <h4 className="text-[13px] font-semibold mb-3">Python (Anthropic SDK)</h4>
        <CodeBlock title="Python" code={`${hl('import')} anthropic\n\nclient = anthropic.Anthropic(\n    base_url=${hl('"https://gw.edgey.shop/v1"')},\n    api_key=${hl(`"${userKey}"`)},\n)\n\nmessage = client.messages.create(\n    model=${hl('"claude-sonnet-5"')},\n    max_tokens=1024,\n    messages=[{${hl('"role"')}: ${hl('"user"')}, ${hl('"content"')}: ${hl('"Hello!"')}}],\n)\nprint(message.content[0].text)`} />
      </Step>
    </>
  );
}

function EnvVarsSetup({ userKey }: { userKey: string }) {
  return (
    <>
      <ToolHeader badge="$_" name="Environment Variables" desc="Set these for any OpenAI-compatible tool." gradient="linear-gradient(135deg, #2563eb, #60a5fa)" />
      <Step num="01">
        <h4 className="text-[13px] font-semibold mb-3">Set your variables</h4>
        <OsTabs tabs={[{ id: 'win', label: 'Windows' }, { id: 'unix', label: 'macOS / Linux' }, { id: 'cmd', label: 'CMD' }]}>
          {active => {
            if (active === 'win') return <CodeBlock title="PowerShell" code={`${hl('$env:')}OPENAI_BASE_URL = ${hl('"https://gw.edgey.shop/v1"')}\n${hl('$env:')}OPENAI_API_KEY = ${hl(`"${userKey}"`)}`} />;
            if (active === 'unix') return <CodeBlock title="Bash / Zsh" code={`${hl('export')} OPENAI_BASE_URL=${hl('"https://gw.edgey.shop/v1"')}\n${hl('export')} OPENAI_API_KEY=${hl(`"${userKey}"`)}`} />;
            return <CodeBlock title="Command Prompt" code={`${hl('set')} OPENAI_BASE_URL=https://gw.edgey.shop/v1\n${hl('set')} OPENAI_API_KEY=${hl(userKey)}`} />;
          }}
        </OsTabs>
      </Step>
    </>
  );
}

function ApiRefSetup() {
  return (
    <>
      <ToolHeader badge="{}" name="API Reference" desc='All endpoints at gw.edgey.shop' gradient="linear-gradient(135deg, #d97706, #fbbf24)" />
      <Step num="01">
        <h4 className="text-[13px] font-semibold mb-3">Endpoints</h4>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead><tr>{['Method', 'Endpoint', 'Auth', 'Description'].map(h => <th key={h} className="text-left px-3 py-2 text-muted font-medium text-[10px] uppercase tracking-wider" style={{ borderBottom: '1px solid var(--color-border)', fontFamily: 'var(--font-mono)' }}>{h}</th>)}</tr></thead>
            <tbody>
              {[
                { method: 'POST', endpoint: '/v1/chat/completions', auth: 'API Key', desc: 'OpenAI-compatible chat completions', color: '#4ade80' },
                { method: 'POST', endpoint: '/v1/messages', auth: 'API Key', desc: 'Anthropic-compatible messages', color: '#4ade80' },
                { method: 'GET', endpoint: '/v1/models', auth: 'API Key', desc: 'List available models', color: 'var(--color-accent)' },
                { method: 'GET', endpoint: '/v1/account', auth: 'API Key', desc: 'Account balance info', color: 'var(--color-accent)' },
                { method: 'POST', endpoint: '/v1/messages/count_tokens', auth: 'API Key', desc: 'Count tokens (free)', color: '#4ade80' },
                { method: 'GET', endpoint: '/v1/cli-capabilities', auth: 'API Key', desc: 'CLI capabilities & modes', color: 'var(--color-accent)' },
              ].map(r => (
                <tr key={r.endpoint} className="hover:bg-white/[0.02]">
                  <td className="px-3 py-2" style={{ borderBottom: '1px solid var(--color-border)' }}><span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold" style={{ background: r.color + '18', color: r.color }}>{r.method}</span></td>
                  <td className="px-3 py-2 text-[11px] text-text2" style={{ borderBottom: '1px solid var(--color-border)', fontFamily: 'var(--font-mono)' }}>{r.endpoint}</td>
                  <td className="px-3 py-2" style={{ borderBottom: '1px solid var(--color-border)' }}>{r.auth}</td>
                  <td className="px-3 py-2" style={{ borderBottom: '1px solid var(--color-border)' }}>{r.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Step>
      <Step num="02">
        <h4 className="text-[13px] font-semibold mb-3">Supported Models</h4>
        <ModelList />
      </Step>
    </>
  );
}
