import { useEffect, useRef, useState } from "react";
import logo from "/assets/openai-logomark.svg";
import EventLog from "./EventLog";
import SessionControls from "./SessionControls";
import ToolPanel from "./ToolPanel";
import React, { useEffect } from "react";
import JanusClient from "./JanusClient";

export default function App() {
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [events, setEvents] = useState([]);
  const [dataChannel, setDataChannel] = useState(null);
  const [janusConnected, setJanusConnected] = useState(false);
  const peerConnection = useRef(null);
  const audioElement = useRef(null);
  const janusClientRef = useRef(null);
  const openAiStreamRef = useRef(null);
  const janusStreamRef = useRef(null);


  async function startSession() {
    // Get an ephemeral key from the Fastify server
    const tokenResponse = await fetch("/token");
    const data = await tokenResponse.json();
    const EPHEMERAL_KEY = data.client_secret.value;
    const realtime_model = data.model;

    // Create a peer connection
    const pc = new RTCPeerConnection();

    // Set up to play remote audio from the model
    audioElement.current = document.createElement("audio");
    audioElement.current.autoplay = true;

    pc.ontrack = (e) => {
      audioElement.current = e.streams[0];

      if (janusConnected) {
        if (janusClientRef.current) {
          janusClientRef.current.sendAudioToJanus(e.streams[0]);
        }
      } else {
        audioElement.current.srcObject = e.streams[0];
      }
    };

    try {
      let ms;

      if (janusConnected && janusStreamRef.current) {
        ms = janusStreamRef.current;
      } else {
        // Add local audio track for microphone input in the browser
        ms = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
      }

      pc.addTrack(ms.getTracks()[0]);
    } catch (e) {
      console.error("Error accessing audio device:", e);
    }


    // Set up data channel for sending and receiving events
    const dc = pc.createDataChannel("oai-events");
    setDataChannel(dc);

    // Start the session using the Session Description Protocol (SDP)
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const baseUrl = "https://api.openai.com/v1/realtime";
    const model = realtime_model;
    const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${EPHEMERAL_KEY}`,
        "Content-Type": "application/sdp",
      },
    });

    const answer = {
      type: "answer",
      sdp: await sdpResponse.text(),
    };
    await pc.setRemoteDescription(answer);

    peerConnection.current = pc;
  }

  // Inicialize Janus client
  useEffect(() => {
    if (isSessionActive) {
      // Create new instance of Janus client
      const janusClient = JanusClient({
        onModelAudio: (stream) => {
          // Audio from other peer in the room
          janusStreamRef.current = stream;

          if (!openAiStreamRef.current) {
            audioElement.current.srcObject = stream;
          }
      },
      onUserAudio: (stream) => {
        // Audio mixed from the room, including our own voice
        // this would be sent to the model
        if (peerConnection.current) {
          const sender = peerConnection.current.getSenders().find((s) => s.track.kind === "audio");
          if (sender && stream.getAudioTracks().length > 0) {
            sender.replaceTrack(stream.getAudioTracks()[0]);
          }
        }
      },
      onJanusConnected: () => {
        setJanusConnected(true);
        console.log("Janus connected successfully");
      },
      onJanusDisconnected: () => {
        setJanusConnected(false);
        console.log("Janus disconnected");
      },
      isSessionActive
      });

      janusClientRef.current = janusClient;
    }

    return () => {
      // Clean up Janus client
      if (janusClientRef.current) {
        janusClientRef.current.destroy();
        janusClientRef.current = null;
      }
    };
  }, [isSessionActive]);

  // Forward OpenAi audio stream to Janus when available
  useEffect(() => {
    if (janusConnected && openAiStreamRef.current && janusClientRef.current) {
      janusClientRef.current.sendAudioToJanus(openAiStreamRef.current);
    }
  }, [janusConnected, openAiStreamRef.current]);

  // Stop current session, clean up peer connection and data channel
  function stopSession() {
    if (dataChannel) {
      dataChannel.close();
    }

    if (peerConnection.current) {
      peerConnection.current.getSenders().forEach((sender) => {
        if (sender.track) {
          sender.track.stop();
        }
      });

      peerConnection.current.close();
    }

    if (janusClientRef.current) {
      janusClientRef.current.destroy();
      janusClientRef.current = null;
    }

    setIsSessionActive(false);
    setDataChannel(null);
    peerConnection.current = null;
    openAiStreamRef.current = null;
  }

  // Send a message to the model
  function sendClientEvent(message) {
    if (dataChannel) {
      message.event_id = message.event_id || crypto.randomUUID();
      dataChannel.send(JSON.stringify(message));
      setEvents((prev) => [message, ...prev]);
    } else {
      console.error(
        "Failed to send message - no data channel available",
        message,
      );
    }
  }

  // Send a text message to the model
  function sendTextMessage(message) {
    const event = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: message,
          },
        ],
      },
    };

    sendClientEvent(event);
    sendClientEvent({ type: "response.create" });
  }

  // Attach event listeners to the data channel when a new one is created
  useEffect(() => {
    if (dataChannel) {
      // Append new server events to the list
      dataChannel.addEventListener("message", (e) => {
        setEvents((prev) => [JSON.parse(e.data), ...prev]);
      });

      // Set session active when the data channel is opened
      dataChannel.addEventListener("open", () => {
        setIsSessionActive(true);
        setEvents([]);
      });
    }
  }, [dataChannel]);

  return (
    <>
      <nav className="absolute top-0 left-0 right-0 h-16 flex items-center">
        <div className="flex items-center gap-4 w-full m-4 pb-2 border-0 border-b border-solid border-gray-200">
          <img style={{ width: "24px" }} src={logo} />
          <h1>realtime console</h1>
        </div>
      </nav>
      <main className="absolute top-16 left-0 right-0 bottom-0">
        <section className="absolute top-0 left-0 right-[380px] bottom-0 flex">
          <section className="absolute top-0 left-0 right-0 bottom-32 px-4 overflow-y-auto">
            <EventLog events={events} />
          </section>
          <section className="absolute h-32 left-0 right-0 bottom-0 p-4">
            <SessionControls
              startSession={startSession}
              stopSession={stopSession}
              sendClientEvent={sendClientEvent}
              sendTextMessage={sendTextMessage}
              events={events}
              isSessionActive={isSessionActive}
            />
          </section>
        </section>
        <section className="absolute top-0 w-[380px] right-0 bottom-0 p-4 pt-0 overflow-y-auto">
          <ToolPanel
            sendClientEvent={sendClientEvent}
            sendTextMessage={sendTextMessage}
            events={events}
            isSessionActive={isSessionActive}
          />
        </section>
      </main>
    </>
  );
}
