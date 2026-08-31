import React, { useState } from 'react';
import {
  X,
  FileText,
  UploadCloud,
  CheckCircle2,
  Sparkles,
  Shield,
  Clock,
  Layers,
  AlertCircle,
} from 'lucide-react';
import { ConfidentialityLevel, DocumentCategory, User } from '../types';
import { governanceEngine } from '../services/governance';
import { parseUploadedFile } from '../utils/fileParser';

interface CreateDocumentModalProps {
  currentUser: User;
  onClose: () => void;
  onSuccess: () => void;
}

export const CreateDocumentModal: React.FC<CreateDocumentModalProps> = ({
  currentUser,
  onClose,
  onSuccess,
}) => {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<DocumentCategory>(DocumentCategory.POLICY);
  const [department, setDepartment] = useState('Human Resources');
  const [confidentiality, setConfidentiality] = useState<ConfidentialityLevel>(ConfidentialityLevel.PUBLIC);
  const [acknowledgementRequired, setAcknowledgementRequired] = useState(true);
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().split('T')[0]);
  const [reviewDueDate, setReviewDueDate] = useState(
    new Date(Date.now() + 365 * 86400000).toISOString().split('T')[0]
  );
  const [description, setDescription] = useState('');
  const [rawContent, setRawContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileDataUrl, setFileDataUrl] = useState<string>('');
  const [mimeType, setMimeType] = useState<string>('');
  const [parsingFile, setParsingFile] = useState<boolean>(false);
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Live preview of generated ID
  const previewDocId = governanceEngine.generateNextDocumentId(category);

  // Quick Template Injector for demo & testing
  const loadTemplate = (type: 'remote' | 'conduct' | 'wellness') => {
    setFileDataUrl('');
    setMimeType('text/markdown');
    setUploadStatus('');
    if (type === 'remote') {
      setTitle('Hybrid Workplace & Remote Work Agreement');
      setCategory(DocumentCategory.POLICY);
      setDescription('Company-wide guidelines for remote workplace safety, core overlap hours, and reimbursement.');
      setFileName('AMA-HR-POL_Hybrid-Workplace_v1.0.md');
      setRawContent(`# Hybrid Workplace & Remote Work Agreement
**Document ID:** ${previewDocId}
**Version:** 1.0 (Initial Baseline)
**Effective Date:** ${effectiveFrom}

## 1. Purpose & Scope
This policy establishes standard protocols for eligible staff to work remotely up to three days per week across Amaavigo Global Inc.

## 2. Eligibility & Onboarding
Employees who have successfully passed their initial 60-day performance review and have department head concurrence may apply.

## 3. Core Working Hours
All remote team members must be logged into corporate communication tools between 09:00 and 17:00 local time.

## 4. Hardware & VPN Requirements
Corporate-issued laptops configured with encrypted disk storage and active VPN connections must be used for all internal access.`);
    } else if (type === 'conduct') {
      setTitle('Corporate Code of Ethics and Professional Conduct');
      setCategory(DocumentCategory.POLICY);
      setDescription('Mandatory standards for professional integrity, non-discrimination, anti-harassment, and conflict of interest disclosure.');
      setFileName('AMA-HR-POL_Code-of-Conduct_v1.0.md');
      setRawContent(`# Corporate Code of Ethics and Professional Conduct
**Document ID:** ${previewDocId}
**Version:** 1.0 (Initial Baseline)
**Effective Date:** ${effectiveFrom}

## 1. Executive Summary
Amaavigo Global Inc. is committed to fostering an inclusive, respectful, and legally compliant workplace culture.

## 2. Workplace Respect & Zero Tolerance Harassment
We maintain strict zero tolerance for harassment, discrimination, or retaliation based on race, gender, religion, sexual orientation, or disability.

## 3. Conflict of Interest Disclosure
Employees must immediately disclose any secondary employment or external financial interest that may conflict with their primary duties.`);
    } else {
      setTitle('Employee Wellness & Mental Health Day Protocol');
      setCategory(DocumentCategory.SOP);
      setDescription('Standard procedure for logging wellness days without physician notes.');
      setFileName('AMA-HR-SOP_Wellness-Days_v1.0.md');
      setRawContent(`# Standard Operating Procedure: Employee Wellness Days
**Document ID:** ${previewDocId}
**Version:** 1.0 (Initial Baseline)
**Effective Date:** ${effectiveFrom}

## 1. Objective
To streamline the scheduling and taking of designated company mental health and wellness days.

## 2. Notification Procedure
Employees should notify their immediate manager via the HR self-service portal at least 24 hours in advance whenever practical. No medical certificate is required.`);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setParsingFile(true);
    setFileName(file.name);
    if (!title) {
      setTitle(file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' '));
    }

    try {
      const parsed = await parseUploadedFile(file);
      setRawContent(parsed.extractedText || '');
      setFileDataUrl(parsed.fileDataUrl || '');
      setMimeType(parsed.mimeType || 'text/plain');
      if (parsed.isPdf) {
        setUploadStatus(`PDF document loaded (${(file.size / 1024).toFixed(1)} KB) • Text extracted successfully`);
      } else {
        setUploadStatus(`Document loaded (${(file.size / 1024).toFixed(1)} KB)`);
      }
    } catch (err: any) {
      console.error('File parse error:', err);
      setError('Could not process file format. You can manually paste document text below.');
    } finally {
      setParsingFile(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Document title is required.');
      return;
    }
    if (!rawContent.trim()) {
      setError('Document content or file upload is required.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      await governanceEngine.createDocument(currentUser, {
        title: title.trim(),
        category,
        companyId: currentUser.companyId,
        companyName: currentUser.companyName,
        departmentId: department.toLowerCase().replace(/\s+/g, '-'),
        departmentName: department,
        processOwnerId: currentUser.id,
        processOwnerName: currentUser.name,
        confidentiality,
        acknowledgementRequired: confidentiality === ConfidentialityLevel.INTERNAL ? false : acknowledgementRequired,
        effectiveFrom,
        reviewDueDate,
        description,
        fileName: fileName || `${title.replace(/[^a-zA-Z0-9]/g, '_')}_v1.0.txt`,
        rawContent,
        fileDataUrl,
        mimeType: mimeType || (fileName.endsWith('.pdf') ? 'application/pdf' : 'text/markdown'),
      });

      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to create document');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* HEADER */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-[#FA7014]/20 border border-[#FA7014]/40 flex items-center justify-center shadow-inner">
              <FileText className="w-5 h-5 text-[#FA7014]" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Create New Document Master</h2>
              <p className="text-xs text-slate-400">
                Creates permanent logical record + initial baseline Version 1.0 (IN REVIEW)
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* TEMPLATE QUICK BAR */}
        <div className="bg-slate-50 border-b border-slate-200 px-6 py-2.5 flex flex-wrap items-center justify-between text-xs text-slate-700 shrink-0 gap-2">
          <div className="flex items-center space-x-1.5">
            <Sparkles className="w-4 h-4 text-[#FA7014] shrink-0" />
            <span className="font-semibold text-slate-900">Quick Sample Templates for testing:</span>
          </div>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => loadTemplate('remote')}
              className="bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors"
            >
              Hybrid Work Policy
            </button>
            <button
              type="button"
              onClick={() => loadTemplate('conduct')}
              className="bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors"
            >
              Code of Conduct
            </button>
            <button
              type="button"
              onClick={() => loadTemplate('wellness')}
              className="bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors"
            >
              Wellness SOP
            </button>
          </div>
        </div>

        {/* FORM BODY */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5 bg-white">
          {error && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-xs text-orange-950 flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-[#FA7014] shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* DOCUMENT ID PREVIEW & TITLE */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-1">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                System-Generated ID
              </label>
              <div className="font-mono text-sm font-bold text-slate-900 bg-slate-50 border border-slate-200 px-3.5 py-2.5 rounded-xl flex items-center justify-between">
                <span>{previewDocId}</span>
                <span className="text-[10px] text-[#FA7014] font-sans font-semibold">v1.0</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Permanent sequence ID</p>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5" htmlFor="input-document-title">
                Document Title <span className="text-[#FA7014]">*</span>
              </label>
              <input
                id="input-document-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Work From Home Policy"
                className="w-full text-sm p-2.5 bg-slate-50 border border-slate-200 text-slate-900 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] focus:bg-white placeholder:text-slate-400 transition-colors"
                required
              />
            </div>
          </div>

          {/* CATEGORY & DEPARTMENT */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5" htmlFor="select-document-category">
                Category <span className="text-[#FA7014]">*</span>
              </label>
              <select
                id="select-document-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as DocumentCategory)}
                className="w-full text-sm p-2.5 bg-slate-50 border border-slate-200 text-slate-900 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] focus:bg-white cursor-pointer"
              >
                {Object.values(DocumentCategory).map((cat) => (
                  <option key={cat} value={cat} className="bg-white text-slate-900 py-1">
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5" htmlFor="select-document-department">
                Department <span className="text-[#FA7014]">*</span>
              </label>
              <select
                id="select-document-department"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full text-sm p-2.5 bg-slate-50 border border-slate-200 text-slate-900 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] focus:bg-white cursor-pointer"
              >
                <option value="Human Resources">Human Resources</option>
                <option value="Operations">Operations</option>
                <option value="Compliance & Legal">Compliance & Legal</option>
                <option value="Engineering & IT">Engineering & IT</option>
                <option value="Finance">Finance</option>
              </select>
            </div>
          </div>

          {/* CONFIDENTIALITY & ACKNOWLEDGEMENT */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5" htmlFor="select-document-confidentiality">
                Confidentiality Level
              </label>
              <select
                id="select-document-confidentiality"
                value={confidentiality}
                onChange={(e) => {
                  const newLvl = e.target.value as ConfidentialityLevel;
                  setConfidentiality(newLvl);
                  if (newLvl === ConfidentialityLevel.INTERNAL) {
                    setAcknowledgementRequired(false);
                  } else {
                    setAcknowledgementRequired(true);
                  }
                }}
                className="w-full text-sm p-2.5 bg-slate-50 border border-slate-200 text-slate-900 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] focus:bg-white cursor-pointer"
              >
                <option value={ConfidentialityLevel.PUBLIC} className="bg-white text-slate-900 py-1">
                  Public (All Employees)
                </option>
                <option value={ConfidentialityLevel.INTERNAL} className="bg-white text-slate-900 py-1">
                  Internal Company
                </option>
              </select>
              <p className="text-[11px] text-slate-500 mt-1">
                {confidentiality === ConfidentialityLevel.INTERNAL
                  ? '🔒 Restricted to HR & Approver only. Hidden from Employee Portal.'
                  : '📢 Published to all employees with compliance notifications.'}
              </p>
            </div>

            <div className="flex flex-col justify-start">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Employee Compliance
              </label>
              <label
                className={`flex items-center space-x-3 p-2.5 rounded-xl border transition-colors ${
                  confidentiality === ConfidentialityLevel.INTERNAL
                    ? 'bg-slate-100/70 border-slate-200 opacity-60 cursor-not-allowed'
                    : 'bg-slate-50 border-slate-200 cursor-pointer hover:border-slate-300'
                }`}
              >
                <input
                  type="checkbox"
                  disabled={confidentiality === ConfidentialityLevel.INTERNAL}
                  checked={confidentiality === ConfidentialityLevel.INTERNAL ? false : acknowledgementRequired}
                  onChange={(e) => setAcknowledgementRequired(e.target.checked)}
                  className="w-4 h-4 text-[#FA7014] rounded bg-white border-slate-300 focus:ring-[#FA7014] cursor-pointer disabled:cursor-not-allowed"
                />
                <div>
                  <span className="text-xs font-bold text-slate-900">Mandatory Employee Acknowledgement</span>
                  <p className="text-[11px] text-slate-500">
                    {confidentiality === ConfidentialityLevel.INTERNAL
                      ? 'Disabled (Internal documents do not require employee sign-off)'
                      : 'Requires employees to sign/acknowledge upon publication'}
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* DATES */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Effective From Date
              </label>
              <input
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className="w-full text-sm p-2.5 bg-slate-50 border border-slate-200 text-slate-900 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] focus:bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Annual Review Due Date
              </label>
              <input
                type="date"
                value={reviewDueDate}
                onChange={(e) => setReviewDueDate(e.target.value)}
                className="w-full text-sm p-2.5 bg-slate-50 border border-slate-200 text-slate-900 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] focus:bg-white"
              />
            </div>
          </div>

          {/* DESCRIPTION */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Purpose / Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief summary of policy intent..."
              className="w-full text-sm p-2.5 bg-slate-50 border border-slate-200 text-slate-900 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] focus:bg-white placeholder:text-slate-400 transition-colors"
            />
          </div>

          {/* FILE UPLOAD & TEXT EDITOR */}
          <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50/50">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-bold text-slate-900 uppercase tracking-wider">
                Document Content / File (PDF, DOCX, Markdown, Text) <span className="text-[#FA7014]">*</span>
              </label>

              <label className="cursor-pointer inline-flex items-center space-x-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-200 px-3 py-1.5 rounded-xl shadow-xs hover:bg-slate-50 transition-colors">
                <UploadCloud className="w-3.5 h-3.5 text-[#FA7014]" />
                <span>Upload File</span>
                <input
                  type="file"
                  accept=".txt,.md,.doc,.docx,.pdf"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>

            {parsingFile && (
              <div className="text-xs text-slate-700 mb-2 font-mono bg-white p-2.5 rounded-xl border border-slate-200 flex items-center space-x-2">
                <Clock className="w-3.5 h-3.5 animate-spin text-[#FA7014]" />
                <span>Parsing file and extracting readable document content...</span>
              </div>
            )}

            {fileName && !parsingFile && (
              <div className="text-xs text-slate-800 mb-2 font-mono bg-white p-2.5 rounded-xl border border-slate-200 flex items-center justify-between">
                <span className="truncate max-w-[70%]">Selected File: {fileName}</span>
                <span className="text-[11px] text-[#FA7014] font-sans font-semibold flex items-center space-x-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{uploadStatus || 'Loaded'}</span>
                </span>
              </div>
            )}

            <textarea
              id="textarea-document-content"
              value={rawContent}
              onChange={(e) => setRawContent(e.target.value)}
              rows={8}
              placeholder="Type, paste, or upload Markdown / policy text here..."
              className="w-full text-xs font-mono p-3 bg-white border border-slate-200 text-slate-900 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] placeholder:text-slate-400"
              required
            />
          </div>

          {/* SUBMIT BUTTONS */}
          <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors"
            >
              Cancel
            </button>
            <button
              id="btn-submit-create-document"
              type="submit"
              disabled={submitting}
              className="bg-[#FA7014] hover:bg-[#E65A05] text-white text-xs font-bold px-6 py-2.5 rounded-xl shadow-md shadow-[#FA7014]/20 flex items-center space-x-2 disabled:opacity-50 transition-all"
            >
              {submitting ? <Clock className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              <span>Create Master & Submit v1.0</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
