
import { GoogleGenAI, Type } from "@google/genai";
import { ContentType } from "./types";

// Inicialización siguiendo las guías de seguridad y parámetros nombrados
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

// Base de Negative Prompting para mejorar la calidad y evitar artefactos
const NEGATIVE_PROMPT_BASE = "blurry, low quality, watermark, text artifacts, extra fingers, deformed hands, distorted face, bad anatomy, grainy, low resolution, cropped, out of frame, signature, cut off, bad proportions";

// Mapeo opcional de estilos con sus respectivos refuerzos negativos
const STYLE_NEGATIVE_PROMPTS: Record<string, string> = {
  "Photorealistic": "cartoon, anime, 3d render, illustration, drawing, painting, digital art, simplified",
  "Anime": "realistic, photo, 3d render, grainy, realistic skin textures, real life",
  "Digital Art": "low detail, sketch, messy, simple shapes, photo",
};

/**
 * Model Routing Helper
 * Selecciona el modelo óptimo basado en criterios de tarea, complejidad y entrada.
 */
interface ModelRoutingParams {
  useCase: 'context_questions' | 'content_generation';
  type: ContentType;
  hasImageRef?: boolean;
  complexity?: 'low' | 'high';
}

const selectModel = ({ useCase, type, hasImageRef, complexity = 'high' }: ModelRoutingParams): string => {
  // Caso 1: Generación de Imágenes (Modelo específico de Imagen)
  if (type === ContentType.IMAGEN && useCase === 'content_generation') {
    return 'gemini-2.5-flash-image';
  }

  // Caso 2: Preguntas de contexto o tareas de baja complejidad (Flash para latencia mínima)
  if (useCase === 'context_questions' || complexity === 'low') {
    return 'gemini-3-flash-preview';
  }

  // Caso 3: Generación de contenido complejo o multimodal (Pro para razonamiento superior)
  if (useCase === 'content_generation') {
    if (type === ContentType.TEXTO || hasImageRef) {
      return 'gemini-3-pro-preview';
    }
  }

  // Fallback por defecto
  return 'gemini-3-flash-preview';
};

/**
 * Genera preguntas iniciales para obtener contexto.
 */
export const generateInitialContextQuestions = async (prompt: string, type: ContentType) => {
  const model = selectModel({ useCase: 'context_questions', type });
  
  const response = await ai.models.generateContent({
    model,
    contents: `Actúa como un Diseñador de Soluciones Digitales. El usuario quiere crear un contenido de tipo ${type} con el siguiente prompt: "${prompt}". 
    Para garantizar un resultado profesional y ético en Marketing, genera 4 preguntas breves para obtener contexto sobre: Objetivo, Público, Tono/Estilo y Restricciones.
    Responde solo con las preguntas en un formato de lista amigable.`,
  });
  return response.text;
};

/**
 * Genera el contenido final (Imagen o Texto).
 * Incluye lógica de Negative Prompting automático para imágenes.
 */
export const generateFinalContent = async (
  prompt: string, 
  type: ContentType, 
  context: any,
  imageRef?: string
) => {
  const model = selectModel({ 
    useCase: 'content_generation', 
    type, 
    hasImageRef: !!imageRef,
    complexity: type === ContentType.TEXTO ? 'high' : 'low' 
  });

  if (type === ContentType.IMAGEN) {
    // Construir prompt negativo basado en el estilo si existe
    const styleSpecificNegative = STYLE_NEGATIVE_PROMPTS[context.style] || "";
    const fullNegativePrompt = `${NEGATIVE_PROMPT_BASE}${styleSpecificNegative ? ", " + styleSpecificNegative : ""}`;

    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [{
          text: `Marketing content generation. Type: Image. 
          Prompt: ${prompt}. 
          Objective: ${context.objective}. 
          Audience: ${context.audience}. 
          Tone: ${context.tone}. 
          Style: ${context.style}. 
          Restrictions: ${context.restrictions}.
          
          Avoid the following (Negative Prompt): ${fullNegativePrompt}.
          
          Professional advertising quality, high detail.`
        }]
      },
      config: { imageConfig: { aspectRatio: "1:1" } }
    });
    
    // Extracción de imagen base64 buscando en las partes de la respuesta
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
    }
    return null;
  } else {
    // Generación de Texto con soporte Multimodal
    const parts: any[] = [
      {
        text: `Actúa como un Editor de Contenido Publicitario. Genera un texto basado en:
        Prompt: ${prompt}
        Objetivo: ${context.objective}
        Público: ${context.audience}
        Tono: ${context.tone}
        Estilo: ${context.style}
        Restricciones: ${context.restrictions}
        ${imageRef ? "Se ha adjuntado una imagen de referencia. Analízala y asegúrate de que el texto sea coherente con lo que se ve en la imagen." : ""}
        
        Asegúrate de que sea profesional, creativo y cumpla con las normas de privacidad.`
      }
    ];

    if (imageRef && imageRef.startsWith('data:')) {
      const base64Data = imageRef.split(',')[1];
      const mimeType = imageRef.split(';')[0].split(':')[1];
      parts.push({
        inlineData: {
          mimeType: mimeType || 'image/png',
          data: base64Data
        }
      });
    }

    const response = await ai.models.generateContent({
      model,
      contents: { parts },
    });
    return response.text;
  }
};
