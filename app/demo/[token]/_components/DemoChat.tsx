"use client";

import React, { useState, useEffect, useRef } from "react";
import { Send, RotateCcw, AlertCircle, Bot, User, ShieldCheck } from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

interface DemoInfo {
  agentName: string;
  orgName: string;
  welcomeMessage: string;
  isDemo: boolean;
  isProvisional: boolean;
}

interface DemoChatProps {
  token: string;
}

export function DemoChat({ token }: DemoChatProps) {
  const [info, setInfo] = useState<DemoInfo | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const storageKey = `euattendo_demo_chat_${token}`;

  // 1. Carrega informações públicas do agente
  useEffect(() => {
    async function loadInfo() {
      try {
        const res = await fetch(`/api/v1/demo/${token}/info`);
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        const data = await res.json();
        if (data.ok && data.data) {
          setInfo(data.data);

          // Carrega histórico salvo na sessão ou adiciona boas-vindas
          const saved = sessionStorage.getItem(storageKey);
          if (saved) {
            try {
              setMessages(JSON.parse(saved));
              return;
            } catch {}
          }

          // Se não há histórico salvo, exibe a saudação inicial do agente
          const initialGreeting: Message = {
            id: "msg-welcome",
            role: "assistant",
            content: data.data.welcomeMessage,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          };
          setMessages([initialGreeting]);
        } else {
          setErrorMessage("Não foi possível carregar a demonstração.");
        }
      } catch {
        setErrorMessage("Erro ao conectar com o servidor.");
      }
    }

    loadInfo();
  }, [token, storageKey]);

  // 2. Salva histórico da sessão quando as mensagens mudam
  useEffect(() => {
    if (messages.length > 0) {
      sessionStorage.setItem(storageKey, JSON.stringify(messages));
    }
  }, [messages, storageKey]);

  // 3. Auto-scroll para a última mensagem
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = inputValue.trim();
    if (!clean || isLoading) return;

    setErrorMessage(null);
    const userMsg: Message = {
      id: `usr-${Date.now()}`,
      role: "user",
      content: clean,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInputValue("");
    setIsLoading(true);

    try {
      const payload = {
        message: clean,
        history: newHistory.map((m) => ({ role: m.role, content: m.content })),
        sessionId: `sess-${token.slice(0, 10)}`,
      };

      const res = await fetch(`/api/v1/demo/${token}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const resData = await res.json();

      if (res.ok && resData.ok && resData.data?.response) {
        const botMsg: Message = {
          id: `bot-${Date.now()}`,
          role: "assistant",
          content: resData.data.response,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        setMessages((prev) => [...prev, botMsg]);
      } else {
        const errorText =
          resData.error?.message ||
          "Ocorreu uma instabilidade temporária. Por favor, tente enviar novamente.";
        setErrorMessage(errorText);
      }
    } catch {
      setErrorMessage("Falha de conexão com a demonstração. Verifique sua rede e tente novamente.");
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleResetChat = () => {
    if (confirm("Deseja reiniciar a conversa da demonstração? O histórico atual será limpo.")) {
      sessionStorage.removeItem(storageKey);
      if (info) {
        setMessages([
          {
            id: `msg-welcome-${Date.now()}`,
            role: "assistant",
            content: info.welcomeMessage,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          },
        ]);
      } else {
        setMessages([]);
      }
      setErrorMessage(null);
    }
  };

  if (notFound) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 bg-slate-50 text-slate-800">
        <div className="max-w-md w-full rounded-xl border border-slate-200 bg-white p-6 shadow-sm text-center space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-semibold">Demonstração Não Encontrada</h2>
          <p className="text-sm text-slate-600">
            O link de demonstração acessado é inválido ou foi revogado.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto bg-white border-x border-slate-200 shadow-lg">
      {/* Cabeçalho */}
      <header className="flex items-center justify-between px-4 py-3 bg-slate-900 text-white border-b border-slate-800">
        <div className="flex items-center space-x-3">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-white font-bold">
            <Bot className="h-6 w-6" />
            <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-slate-900" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="font-semibold text-base leading-tight">
                {info?.agentName || "Assistente Virtual"}
              </h1>
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-950 text-emerald-300 border border-emerald-700/50">
                Demonstração IA
              </span>
            </div>
            <p className="text-xs text-slate-400 leading-tight">
              {info?.orgName || "NB Pneus e Auto Center"}
            </p>
          </div>
        </div>

        <button
          onClick={handleResetChat}
          title="Reiniciar conversa"
          className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      </header>

      {/* Banner de Aviso de Demonstração */}
      <div className="px-4 py-2 bg-emerald-50 border-b border-emerald-100 text-emerald-800 text-xs flex items-center justify-between">
        <div className="flex items-center space-x-1.5">
          <ShieldCheck className="h-4 w-4 text-emerald-600 flex-shrink-0" />
          <span>Ambiente de avaliação de qualidade conversacional de IA.</span>
        </div>
        {info?.isProvisional && (
          <span className="text-[10px] bg-emerald-200/60 px-1.5 py-0.5 rounded text-emerald-900 font-mono">
            Modo Piloto
          </span>
        )}
      </div>

      {/* Área de Mensagens */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
        {messages.map((msg) => {
          const isUser = msg.role === "user";
          return (
            <div
              key={msg.id}
              className={`flex items-end space-x-2 ${isUser ? "justify-end" : "justify-start"}`}
            >
              {!isUser && (
                <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white text-xs">
                  <Bot className="h-4 w-4" />
                </div>
              )}
              <div
                className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                  isUser
                    ? "bg-emerald-600 text-white rounded-br-none"
                    : "bg-white text-slate-800 border border-slate-200/80 rounded-bl-none"
                }`}
              >
                <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                <div
                  className={`mt-1 text-[10px] text-right ${
                    isUser ? "text-emerald-100" : "text-slate-400"
                  }`}
                >
                  {msg.timestamp}
                </div>
              </div>
              {isUser && (
                <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-slate-300 text-slate-700 text-xs">
                  <User className="h-4 w-4" />
                </div>
              )}
            </div>
          );
        })}

        {/* Indicador de Digitação */}
        {isLoading && (
          <div className="flex items-end space-x-2 justify-start">
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white text-xs">
              <Bot className="h-4 w-4" />
            </div>
            <div className="rounded-2xl px-4 py-3 bg-white border border-slate-200 text-slate-500 rounded-bl-none shadow-sm flex items-center space-x-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse delay-150" />
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse delay-300" />
              <span className="text-xs text-slate-400 ml-1">Assistente digitando...</span>
            </div>
          </div>
        )}

        {/* Erro */}
        {errorMessage && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start space-x-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Formulário de Envio */}
      <footer className="p-3 bg-white border-t border-slate-200">
        <form onSubmit={handleSendMessage} className="space-y-1.5">
          <div className="flex items-center space-x-2">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Digite sua dúvida sobre pneus ou serviços..."
              maxLength={500}
              disabled={isLoading}
              className="flex-1 rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!inputValue.trim() || isLoading}
              className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          <div className="flex justify-between items-center px-1 text-[11px] text-slate-400">
            <span>{inputValue.length}/500 caracteres</span>
            <span>Pressione Enter para enviar</span>
          </div>
        </form>
      </footer>
    </div>
  );
}