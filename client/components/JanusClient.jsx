import { useEffect, useRef, useState } from "react";
import { Janus } from "janus-gateway";
import "webrtc-adapter";

export default function JanusClient({ 
  onModelAudio, 
  onUserAudio, 
  onJanusConnected,
  onJanusDisconnected,
  isSessionActive
}) {
  const [janusInstance, setJanusInstance] = useState(null);
  const [audiobridge, setAudiobridge] = useState(null);
  const [remoteFeed, setRemoteFeed] = useState(null);
  const [connected, setConnected] = useState(false);
  const [roomId] = useState(1234); // Configurar con el ID de la sala de Janus
  const [janusServer] = useState("http://localhost:8088/janus");
  const remoteStreams = useRef({});
  const modelStreamRef = useRef(null);
  const myId = useRef(Math.floor(Math.random() * 90000) + 10000);

  // Initialize Janus when component mounts
  useEffect(() => {
    if (isSessionActive && !janusInstance) {
      initializeJanus();
    }

    return () => {
      if (janusInstance) {
        destroyJanus();
      }
    };
  }, [isSessionActive]);

  // Initialize Janus connection
  const initializeJanus = () => {
    Janus.init({
      debug: "all",
      callback: () => {
        const janus = new Janus({
          server: janusServer,
          success: () => {
            console.log("Janus initialized successfully");
            setJanusInstance(janus);
            attachAudioBridgePlugin(janus);
          },
          error: (error) => {
            console.error("Error initializing Janus:", error);
            onJanusDisconnected();
          },
          destroyed: () => {
            console.log("Janus destroyed");
            setConnected(false);
            onJanusDisconnected();
          }
        });
      }
    });
  };

  // Attach to the AudioBridge plugin
  const attachAudioBridgePlugin = (janus) => {
    janus.attach({
      plugin: "janus.plugin.audiobridge",
      opaqueId: "audiobridgetest-" + Janus.randomString(12),
      success: (pluginHandle) => {
        console.log("Plugin attached successfully:", pluginHandle);
        setAudiobridge(pluginHandle);
        
        // Join the room
        joinRoom(pluginHandle);
      },
      error: (error) => {
        console.error("Error attaching plugin:", error);
      },
      onmessage: (msg, jsep) => {
        handleOnMessage(msg, jsep);
      },
      onremotestream: (stream) => {
        console.log("Got a remote stream:", stream);
        // This is the mixed audio stream from the room
        modelStreamRef.current = stream;
        if (onModelAudio) {
          onModelAudio(stream);
        }
      },
      oncleanup: () => {
        console.log("AudioBridge plugin cleaned up");
      }
    });
  };

  // Join the AudioBridge room
  const joinRoom = (pluginHandle) => {
    const joinRequest = {
      request: "join",
      room: roomId,
      display: "OpenAI User",
      id: myId.current,
      muted: false
    };
    
    pluginHandle.send({
      message: joinRequest,
      success: () => {
        console.log("Join request sent successfully");
        // Setup WebRTC connection after joining
        pluginHandle.createOffer({
          media: { 
            audio: true, 
            video: false 
          },
          success: (jsep) => {
            console.log("Got SDP offer:", jsep);
            const publish = { 
              request: "configure", 
              muted: false 
            };
            pluginHandle.send({
              message: publish,
              jsep: jsep,
              success: () => {
                console.log("Published successfully");
                // Listen for other participants audio
                listenForParticipants();
              }
            });
          },
          error: (error) => {
            console.error("Error creating SDP offer:", error);
          }
        });
      }
    });
  };

  // Listen for other participants' audio streams
  const listenForParticipants = () => {
    // Create a new handle to subscribe to the mixed audio
    janusInstance.attach({
      plugin: "janus.plugin.audiobridge",
      opaqueId: "audiobridgesub-" + Janus.randomString(12),
      success: (pluginHandle) => {
        setRemoteFeed(pluginHandle);
        
        // Join the room as a listener
        const listenRequest = {
          request: "join",
          room: roomId,
          display: "OpenAI Listener",
          id: myId.current + 1,
          muted: true
        };
        
        pluginHandle.send({
          message: listenRequest,
          success: () => {
            console.log("Joined as listener");
            setConnected(true);
            if (onJanusConnected) {
              onJanusConnected();
            }
          }
        });
      },
      error: (error) => {
        console.error("Error attaching plugin for listening:", error);
      },
      onmessage: (msg, jsep) => {
        handleListenerMessage(msg, jsep);
      },
      onremotestream: (stream) => {
        console.log("Got a remote stream from listener:", stream);
        // This is where we receive the audio from other participants
        if (onUserAudio) {
          onUserAudio(stream);
        }
      }
    });
  };

  // Handle incoming messages from AudioBridge
  const handleOnMessage = (msg, jsep) => {
    console.log("Got message from AudioBridge:", msg);
    
    if (jsep) {
      console.log("Handling SDP:", jsep);
      audiobridge.handleRemoteJsep({ jsep: jsep });
    }
    
    const event = msg["audiobridge"];
    if (event === "joined") {
      console.log("Successfully joined room", msg["room"]);
    } else if (event === "roomchanged") {
      console.log("Room changed to", msg["room"]);
    } else if (event === "destroyed") {
      console.log("Room destroyed:", msg);
    } else if (event === "event") {
      // Handle room events like participants joining/leaving
      if (msg["participants"]) {
        console.log("Participant list updated:", msg["participants"]);
      }
    }
  };

  // Handle listener messages
  const handleListenerMessage = (msg, jsep) => {
    console.log("Got message for listener:", msg);
    
    if (jsep) {
      console.log("Handling listener SDP:", jsep);
      remoteFeed.createAnswer({
        jsep: jsep,
        media: { audio: true, video: false },
        success: (jsep) => {
          console.log("Got SDP answer for listener:", jsep);
          const body = { request: "start" };
          remoteFeed.send({
            message: body,
            jsep: jsep
          });
        },
        error: (error) => {
          console.error("Error creating answer for listener:", error);
        }
      });
    }
  };

  // Clean up Janus connection
  const destroyJanus = () => {
    if (audiobridge) {
      const leaveRequest = {
        request: "leave"
      };
      
      audiobridge.send({
        message: leaveRequest,
        success: () => {
          audiobridge.detach();
          setAudiobridge(null);
        }
      });
    }
    
    if (remoteFeed) {
      remoteFeed.detach();
      setRemoteFeed(null);
    }
    
    if (janusInstance) {
      janusInstance.destroy();
      setJanusInstance(null);
    }
    
    setConnected(false);
  };

  // Convert OpenAI audio stream to format suitable for Janus
  const sendAudioToJanus = (audioStream) => {
    if (audiobridge && audioStream) {
      // Replace the current audio track with OpenAI's audio track
      const sender = audiobridge.webrtcStuff.pc.getSenders().find(s => s.track.kind === 'audio');
      if (sender) {
        const track = audioStream.getAudioTracks()[0];
        sender.replaceTrack(track);
      }
    }
  };

  // Send local audio to Janus
  const sendLocalAudioToJanus = (audioStream) => {
    if (audiobridge && audioStream) {
      // This would be used when you want to send your microphone audio to Janus
      const replaceAudio = {
        request: "configure",
        muted: false
      };
      
      audiobridge.send({
        message: replaceAudio,
        success: () => {
          const sender = audiobridge.webrtcStuff.pc.getSenders().find(s => s.track.kind === 'audio');
          if (sender) {
            const track = audioStream.getAudioTracks()[0];
            sender.replaceTrack(track);
          }
        }
      });
    }
  };

  return {
    connected,
    sendAudioToJanus,
    sendLocalAudioToJanus,
    destroy: destroyJanus
  };
}