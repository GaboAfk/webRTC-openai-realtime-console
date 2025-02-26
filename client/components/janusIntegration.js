import Janus from './janus.js'; // Asegúrate de incluir la librería Janus

export function initJanusSession() {
  Janus.init({
    debug: "all",
    callback: () => {
      // Crear una sesión en Janus usando el servidor configurado
      const janus = new Janus({
        server: process.env.REACT_APP_JANUS_SERVER || "ws://localhost:8188",
        success: () => {
          // Adjuntar al plugin AudioBridge
          janus.attach({
            plugin: "janus.plugin.audiobridge",
            opaqueId: "audiobridge_user_" + Janus.randomString(12),
            success: (pluginHandle) => {
              console.log("AudioBridge plugin attached (id=" + pluginHandle.getId() + ")");
              // Unirse a una sala de audio (por ejemplo, room 1234)
              const joinRequest = {
                request: "join",
                room: 9876,
                pin: "openai123",
                display: "Usuario OpenAI"
              };
              pluginHandle.send({ message: joinRequest });
              const forwardRequest = {
                request: "rtp_forward",
                room: 9876,
                host: "IP_DEL_BACKEND",
                port: 5004,
                codec: "opus"
              };
              pluginHandle.send({ message: forwardRequest });
            },
            onmessage: (msg, jsep) => {
              console.log("Mensaje de AudioBridge:", msg);
              if (jsep) {
                // Completar la negociación SDP
                pluginHandle.handleRemoteJsep({ jsep: jsep });
              }
            },
            onlocalstream: (stream) => {
              // Aquí se puede adjuntar la transmisión local (audio del micrófono)
              const audioElement = document.getElementById("localAudio");
              Janus.attachMediaStream(audioElement, stream);
            },
            onremotestream: (stream) => {
              // Este stream contendrá la respuesta de nuestro modelo realtime
              const audioElement = document.getElementById("remoteAudio");
              Janus.attachMediaStream(audioElement, stream);
            },
            error: (error) => {
              console.error("Error con AudioBridge plugin:", error);
            }
          });

          // Adjuntar al plugin SIP (si necesitas enrutar la llamada vía SIP)
          janus.attach({
            plugin: "janus.plugin.sip",
            opaqueId: "sip_user_" + Janus.randomString(12),
            success: (pluginHandle) => {
              console.log("SIP plugin attached (id=" + pluginHandle.getId() + ")");
              // Realizar el registro SIP (ajusta usuario, contraseña y servidor)
              const sipRegister = {
                request: "register",
                username: "sip:tuusuario@tuservidor",
                secret: "tu_contraseña"
              };
              pluginHandle.send({ message: sipRegister });
            },
            onmessage: (msg, jsep) => {
              console.log("Mensaje de SIP plugin:", msg);
              // Aquí se pueden manejar eventos SIP (como invitaciones, etc.)
            },
            error: (error) => {
              console.error("Error con SIP plugin:", error);
            }
          });
        },
        error: (error) => {
          console.error("Error al crear la sesión Janus:", error);
        },
        destroyed: () => {
          console.log("Sesión Janus finalizada");
          window.location.reload();
        }
      });
    }
  });
}
