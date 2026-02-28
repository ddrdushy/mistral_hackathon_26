"""Resume text extraction service."""
from typing import Optional
import re
from pathlib import Path
from io import BytesIO


def extract_text_from_pdf(file_path: Optional[str] = None, file_bytes: Optional[bytes] = None) -> str:
    """Extract text from a PDF file."""
    try:
        from PyPDF2 import PdfReader

        if file_bytes:
            reader = PdfReader(BytesIO(file_bytes))
        elif file_path:
            reader = PdfReader(file_path)
        else:
            return ""

        text = ""
        for page in reader.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + "\n"
        return text.strip()
    except Exception as e:
        return f"[PDF extraction error: {e}]"


def extract_text_from_docx(file_path: Optional[str] = None, file_bytes: Optional[bytes] = None) -> str:
    """Extract text from a DOCX file."""
    try:
        from docx import Document

        if file_bytes:
            doc = Document(BytesIO(file_bytes))
        elif file_path:
            doc = Document(file_path)
        else:
            return ""

        text = "\n".join(paragraph.text for paragraph in doc.paragraphs if paragraph.text.strip())
        return text.strip()
    except Exception as e:
        return f"[DOCX extraction error: {e}]"


def extract_text_from_latex(file_bytes: Optional[bytes] = None, file_path: Optional[str] = None) -> str:
    """Extract plain text from a LaTeX file by stripping commands."""
    try:
        if file_bytes:
            text = file_bytes.decode("utf-8", errors="replace")
        elif file_path:
            text = Path(file_path).read_text(errors="replace")
        else:
            return ""

        # Remove comments
        text = re.sub(r'%.*$', '', text, flags=re.MULTILINE)
        # Remove \begin{...} and \end{...}
        text = re.sub(r'\\(begin|end)\{[^}]*\}', '', text)
        # Remove \command{...} but keep content inside braces
        text = re.sub(r'\\[a-zA-Z]+\{([^}]*)\}', r'\1', text)
        # Remove remaining \commands
        text = re.sub(r'\\[a-zA-Z]+\*?', '', text)
        # Remove braces
        text = re.sub(r'[{}]', '', text)
        # Clean up whitespace
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text.strip()
    except Exception as e:
        return f"[LaTeX extraction error: {e}]"


def extract_resume_text(filename: str, file_path: Optional[str] = None, file_bytes: Optional[bytes] = None) -> str:
    """Extract text from a resume file based on extension."""
    ext = Path(filename).suffix.lower()
    if ext == ".pdf":
        return extract_text_from_pdf(file_path=file_path, file_bytes=file_bytes)
    elif ext in (".docx", ".doc"):
        return extract_text_from_docx(file_path=file_path, file_bytes=file_bytes)
    elif ext == ".tex":
        return extract_text_from_latex(file_bytes=file_bytes, file_path=file_path)
    elif ext == ".txt":
        if file_bytes:
            return file_bytes.decode("utf-8", errors="replace")
        elif file_path:
            return Path(file_path).read_text(errors="replace")
    return ""


def parse_contact_info(text: str) -> dict:
    """Try to extract name, email, phone from resume text."""
    result = {"name": "", "email": "", "phone": ""}

    email_match = re.search(r'[\w.+-]+@[\w-]+\.[\w.-]+', text)
    if email_match:
        result["email"] = email_match.group()

    phone_match = re.search(r'[\+]?[\d\s\-\(\)]{10,15}', text)
    if phone_match:
        result["phone"] = phone_match.group().strip()

    lines = text.strip().split('\n')
    for line in lines[:5]:
        line = line.strip()
        if line and not re.search(r'[@\d]', line) and len(line) < 60:
            result["name"] = line
            break

    return result
